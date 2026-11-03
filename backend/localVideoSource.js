import fs from 'node:fs';
import path from 'node:path';

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