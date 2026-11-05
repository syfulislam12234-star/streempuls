import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Resolve app-facing /uploads URLs to a worker-local file without permitting
 * traversal outside the configured uploads directory.
 * @param {string} videoUrl
 * @param {string} uploadsDirectory
 * @returns {string | null}
 */
export function resolveLocalUpload(videoUrl, uploadsDirectory) {
  if (typeof videoUrl !== 'string' || !videoUrl.startsWith('/uploads/')) return null;

  let relativePath;
  try {
    relativePath = decodeURIComponent(videoUrl.slice('/uploads/'.length).split(/[?#]/, 1)[0]);
  } catch {
    throw new Error('The local upload path is invalid.');
  }
  if (!relativePath) throw new Error('The local upload path is invalid.');

  const root = path.resolve(uploadsDirectory);
  const filePath = path.resolve(root, relativePath);
  if (filePath === root || !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('The local upload path is invalid.');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('The local upload is unavailable in the worker container.');
  }

  return filePath;
}

/**
 * Download a remote video to a local file before FFmpeg starts reading it.
 * URLs and response bodies are deliberately excluded from errors/logs.
 * @param {string} sourceUrl
 * @param {string} destinationPath
 * @param {{ timeoutMs?: number, maxBytes?: number, expectedBytes?: number }} [options]
 * @returns {Promise<string>}
 */
export async function downloadVideoToLocalFile(sourceUrl, destinationPath, {
  timeoutMs = 15 * 60 * 1000,
  maxBytes = 5 * 1024 * 1024 * 1024,
  expectedBytes,
  signal,
} = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error('The remote video source is invalid.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('The remote video source must use HTTP or HTTPS.');
  }

  const resolvedDestination = path.resolve(destinationPath);
  const temporaryPath = `${resolvedDestination}.part-${randomUUID()}`;
  const controller = new AbortController();
  const abortDownload = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortDownload, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  let receivedBytes = 0;

  try {
    await fs.promises.mkdir(path.dirname(resolvedDestination), { recursive: true });
    const response = await fetch(parsedUrl, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error('The remote video server returned an unsuccessful response.');
    }

    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error('The remote video exceeds the local cache size limit.');
    }
    if (Number.isFinite(expectedBytes) && Number.isFinite(contentLength) && contentLength !== expectedBytes) {
      throw new Error('The remote video size did not match the storage metadata.');
    }

    const byteLimit = new Transform({
      transform(chunk, _encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          callback(new Error('The remote video exceeds the local cache size limit.'));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body),
      byteLimit,
      fs.createWriteStream(temporaryPath, { flags: 'wx' }),
      { signal: controller.signal },
    );

    if (receivedBytes === 0 || (Number.isFinite(expectedBytes) && receivedBytes !== expectedBytes)) {
      throw new Error('The downloaded video was empty or incomplete.');
    }
    await fs.promises.rename(temporaryPath, resolvedDestination);
    return resolvedDestination;
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    if (controller.signal.aborted) {
      throw new Error('Downloading the video to local storage timed out.');
    }
    const safeMessages = new Set([
      'The remote video server returned an unsuccessful response.',
      'The remote video exceeds the local cache size limit.',
      'The remote video size did not match the storage metadata.',
      'The downloaded video was empty or incomplete.',
    ]);
    throw new Error(safeMessages.has(error.message)
      ? error.message
      : 'Downloading the video to local storage failed.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortDownload);
  }
}