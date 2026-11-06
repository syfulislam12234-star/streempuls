import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireRedisLease } from './redisLease.js';

const CACHE_LOCK_TTL_MS = 60_000;
const CACHE_LOCK_RENEW_MS = 15_000;
const MAX_CONCURRENT_CACHE_DOWNLOADS = Math.max(1, Number(process.env.VIDEO_CACHE_DOWNLOAD_CONCURRENCY) || 2);
const CACHE_WAIT_TIMEOUT_MS = 30 * 60 * 1000;
const CACHE_MAX_FILE_BYTES = 5_000_000_000;
const CACHE_MANIFEST_VERSION = 1;
const WORKER_INSTANCE_ID = `${process.env.WORKER_INSTANCE_ID || 'worker'}:${randomUUID()}`;

async function getContainerInstanceId() {
  if (/^[a-f0-9]{12,64}$/i.test(process.env.WORKER_CONTAINER_ID || '')) {
    return process.env.WORKER_CONTAINER_ID;
  }
  try {
    const cgroup = await fs.promises.readFile('/proc/self/cgroup', 'utf8');
    const match = /(?:docker|containerd|cri-containerd)[-/]([a-f0-9]{64})(?:\.scope)?/i.exec(cgroup);
    if (match) return match[1];
  } catch {}
  const hostname = os.hostname();
  return /^[a-f0-9]{12,64}$/i.test(hostname) ? hostname : null;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Video cache operation was cancelled.'));
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Video cache operation was cancelled.'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createInProcessCacheLockProvider() {
  const heldLocks = new Set();
  return {
    namespace: `streempulse:video-cache:local:${randomUUID()}`,
    async acquire(key) {
      if (heldLocks.has(key)) return null;
      heldLocks.add(key);
      let released = false;
      const lostHandlers = new Set();
      return {
        get lost() { return false; },
        onLost(handler) {
          lostHandlers.add(handler);
          return () => lostHandlers.delete(handler);
        },
        async release() {
          if (released) return false;
          released = true;
          heldLocks.delete(key);
          return true;
        },
      };
    },
  };
}

const redisCacheLockProvider = (redis, namespace) => ({
  namespace: `streempulse:video-cache:${namespace}`,
  acquire: (key) => acquireRedisLease(redis, key, {
    ttlMs: CACHE_LOCK_TTL_MS,
    renewIntervalMs: CACHE_LOCK_RENEW_MS,
  }),
});

async function ensureCacheNamespace(cacheDir) {
  const namespaceFile = path.join(cacheDir, '.namespace');
  try {
    const existing = (await fs.promises.readFile(namespaceFile, 'utf8')).trim();
    if (/^[a-f0-9-]{36}$/.test(existing)) return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generated = randomUUID();
  try {
    await fs.promises.writeFile(namespaceFile, generated, { flag: 'wx', mode: 0o600 });
    return generated;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = (await fs.promises.readFile(namespaceFile, 'utf8')).trim();
    if (!/^[a-f0-9-]{36}$/.test(existing)) throw new Error('Local video cache namespace is invalid.');
    return existing;
  }
}

async function acquireLock(lockProvider, key, signal, waitUntil) {
  while (Date.now() < waitUntil) {
    if (signal?.aborted) throw new Error('Video cache operation was cancelled.');
    const lease = await lockProvider.acquire(key);
    if (lease) return lease;
    await sleep(250, signal);
  }
  throw new Error('Timed out waiting for another worker to prepare this video.');
}

async function acquireDownloadSlot(lockProvider, signal) {
  const waitUntil = Date.now() + CACHE_WAIT_TIMEOUT_MS;
  while (Date.now() < waitUntil) {
    if (signal?.aborted) throw new Error('Video cache operation was cancelled.');
    for (let slot = 0; slot < MAX_CONCURRENT_CACHE_DOWNLOADS; slot++) {
      const lease = await lockProvider.acquire(`${lockProvider.namespace}:download-slot:${slot}`);
      if (lease) return lease;
    }
    await sleep(250, signal);
  }
  throw new Error('Timed out waiting for an available video download slot.');
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function readVerifiedCache(filePath, manifestPath, cacheId, expectedBytes, identity) {
  try {
    const [manifest, stat] = await Promise.all([
      fs.promises.readFile(manifestPath, 'utf8').then(JSON.parse),
      fs.promises.stat(filePath),
    ]);
    if (manifest.version !== CACHE_MANIFEST_VERSION
      || manifest.cacheId !== cacheId
      || !Number.isSafeInteger(manifest.sizeBytes)
      || stat.size !== manifest.sizeBytes
      || (Number.isSafeInteger(expectedBytes) && stat.size !== expectedBytes)
      || (manifest.sourceEtag || null) !== (identity.etag || null)
      || (manifest.sourceLastModified || null) !== (identity.lastModified || null)
      || typeof manifest.sha256 !== 'string') {
      return null;
    }
    if (await hashFile(filePath) !== manifest.sha256) return null;
    return { ...manifest, sizeBytes: stat.size };
  } catch {
    return null;
  }
}

async function writeJsonAtomically(filePath, data) {
  const temporaryPath = `${filePath}.part-${randomUUID()}`;
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function createUsageLease(cacheDir, cacheId) {
  const leaseDirectory = path.join(cacheDir, '.leases', cacheId);
  await fs.promises.mkdir(leaseDirectory, { recursive: true });
  const leaseId = randomUUID();
  const leasePath = path.join(leaseDirectory, leaseId);
  const leaseRecord = {
    version: 1,
    leaseId,
    cacheId,
    workerInstanceId: WORKER_INSTANCE_ID,
    containerInstanceId: await getContainerInstanceId(),
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(leasePath, JSON.stringify(leaseRecord), { flag: 'wx', mode: 0o600 });
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await fs.promises.rm(leasePath, { force: true }).catch(() => {});
    },
  };
}

/**
 * Reclaim usage leases only when an authoritative host/container runtime
 * confirms the exact recorded container instance has exited. No age-based
 * reclamation is performed. Callers without that verifier fail closed.
 */
export async function reapCacheUsageLeases(cacheDir, {
  redis,
  lockProvider,
  verifyContainerExited,
} = {}) {
  if (typeof verifyContainerExited !== 'function') {
    return { reaped: 0, skipped: 0 };
  }
  const resolvedCacheDir = path.resolve(cacheDir);
  await fs.promises.mkdir(resolvedCacheDir, { recursive: true, mode: 0o750 });
  const namespace = await ensureCacheNamespace(resolvedCacheDir);
  const resolvedLockProvider = lockProvider || (redis ? redisCacheLockProvider(redis, namespace) : null);
  if (!resolvedLockProvider || typeof resolvedLockProvider.namespace !== 'string') {
    return { reaped: 0, skipped: 0 };
  }
  const leaseRoot = path.join(resolvedCacheDir, '.leases');
  let cacheDirectories;
  try {
    cacheDirectories = await fs.promises.readdir(leaseRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { reaped: 0, skipped: 0 };
    throw error;
  }

  let reaped = 0;
  let skipped = 0;
  for (const directory of cacheDirectories) {
    if (!directory.isDirectory() || !/^[a-f0-9]{64}$/.test(directory.name)) continue;
    const cacheId = directory.name;
    const leaseDirectory = path.join(leaseRoot, cacheId);
    const leases = await fs.promises.readdir(leaseDirectory, { withFileTypes: true });
    for (const lease of leases) {
      if (!lease.isFile() || !/^[a-f0-9-]{36}$/i.test(lease.name)) continue;
      const leasePath = path.join(leaseDirectory, lease.name);
      let candidate;
      try { candidate = JSON.parse(await fs.promises.readFile(leasePath, 'utf8')); } catch { skipped++; continue; }
      if (candidate.version !== 1 || candidate.cacheId !== cacheId
        || candidate.leaseId !== lease.name
        || typeof candidate.workerInstanceId !== 'string'
        || !/^[a-f0-9]{12,64}$/i.test(candidate.containerInstanceId || '')) {
        skipped++;
        continue;
      }

      let lock;
      try {
        lock = await acquireLock(
          resolvedLockProvider,
          `${resolvedLockProvider.namespace}:${cacheId}`,
          undefined,
          Date.now() + 1_000,
        );
      } catch {
        skipped++;
        continue;
      }
      try {
        let current;
        try { current = JSON.parse(await fs.promises.readFile(leasePath, 'utf8')); } catch { continue; }
        if (current.leaseId !== candidate.leaseId
          || current.workerInstanceId !== candidate.workerInstanceId
          || current.containerInstanceId !== candidate.containerInstanceId) {
          skipped++;
          continue;
        }

        let verification;
        try { verification = await verifyContainerExited(candidate.containerInstanceId); } catch { verification = null; }
        if (!verification
          || verification.requestedId !== candidate.containerInstanceId
          || !/^[a-f0-9]{64}$/i.test(verification.containerId || '')
          || !(verification.containerId === candidate.containerInstanceId
            || verification.containerId.startsWith(candidate.containerInstanceId))
          || verification.state !== 'exited'
          || verification.running !== false) {
          skipped++;
          continue;
        }
        await fs.promises.rm(leasePath, { force: true });
        reaped++;
      } finally {
        await lock.release();
      }
    }
  }
  return { reaped, skipped };
}

async function activeUsageLeaseExists(cacheDir, cacheId) {
  const leaseDirectory = path.join(cacheDir, '.leases', cacheId);
  let entries;
  try {
    entries = await fs.promises.readdir(leaseDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  // A stale heartbeat cannot prove FFmpeg stopped: the owner process may be
  // stalled while its child still reads the file. Fail closed and require
  // explicit lease release before eviction or version replacement.
  return entries.length > 0;
}

async function getDiskStats(cacheDir) {
  const stats = await fs.promises.statfs(cacheDir);
  const blockSize = Number(stats.bsize);
  const totalBytes = blockSize * Number(stats.blocks);
  const availableBytes = blockSize * Number(stats.bavail);
  if (!Number.isFinite(totalBytes) || !Number.isFinite(availableBytes)) {
    throw new Error('Local video cache disk space could not be measured.');
  }
  return { totalBytes, availableBytes };
}

async function listCacheEntries(cacheDir) {
  const entries = await fs.promises.readdir(cacheDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.media')) continue;
    const cacheId = entry.name.slice(0, -'.media'.length);
    const mediaPath = path.join(cacheDir, entry.name);
    const manifestPath = path.join(cacheDir, `${cacheId}.json`);
    let manifest = null;
    let stat;
    try {
      [manifest, stat] = await Promise.all([
        fs.promises.readFile(manifestPath, 'utf8').then(JSON.parse),
        fs.promises.stat(mediaPath),
      ]);
    } catch {
      continue;
    }
    if (manifest.version !== CACHE_MANIFEST_VERSION || manifest.cacheId !== cacheId) continue;
    files.push({ cacheId, mediaPath, manifestPath, sizeBytes: stat.size, lastAccessedAt: Number(manifest.lastAccessedAt) || stat.mtimeMs });
  }
  return files;
}

async function readReservations(cacheDir) {
  const reservationDirectory = path.join(cacheDir, '.reservations');
  let names;
  try {
    names = await fs.promises.readdir(reservationDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const reservations = [];
  for (const name of names) {
    const filePath = path.join(reservationDirectory, name);
    try {
      const [contents, stat] = await Promise.all([
        fs.promises.readFile(filePath, 'utf8').then(JSON.parse),
        fs.promises.stat(filePath),
      ]);
      if (Date.now() - stat.mtimeMs > CACHE_LOCK_TTL_MS * 2) {
        await fs.promises.rm(filePath, { force: true });
      } else if (Number.isSafeInteger(contents.bytes) && contents.bytes > 0) {
        reservations.push({ filePath, bytes: contents.bytes });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') await fs.promises.rm(filePath, { force: true }).catch(() => {});
    }
  }
  return reservations;
}

async function makeRoom({ lockProvider, cacheDir, requiredBytes, protectedCacheId, minFreeBytes }) {
  const deadline = Date.now() + CACHE_WAIT_TIMEOUT_MS;
  const globalLock = await acquireLock(lockProvider, `${lockProvider.namespace}:capacity`, undefined, deadline);
  try {
    const { totalBytes } = await getDiskStats(cacheDir);
    const maxCacheBytes = Number(process.env.VIDEO_CACHE_MAX_BYTES)
      || Math.floor(totalBytes * 0.6);
    if (requiredBytes > maxCacheBytes) throw new Error('The video is larger than the configured local cache capacity.');

    let files = await listCacheEntries(cacheDir);
    let reservations = await readReservations(cacheDir);
    const previousVersion = files.find((file) => file.cacheId === protectedCacheId);
    if (previousVersion) {
      if (await activeUsageLeaseExists(cacheDir, protectedCacheId)) {
        throw new Error('The cached video changed while another stream is using the previous version.');
      }
      await Promise.all([
        fs.promises.rm(previousVersion.mediaPath, { force: true }),
        fs.promises.rm(previousVersion.manifestPath, { force: true }),
      ]);
      files = files.filter((file) => file.cacheId !== protectedCacheId);
    }
    const usage = () => files.reduce((total, file) => total + file.sizeBytes, 0)
      + reservations.reduce((total, reservation) => total + reservation.bytes, 0);

    const ordered = files.filter((file) => file.cacheId !== protectedCacheId)
      .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
    while (usage() + requiredBytes > maxCacheBytes) {
      let evicted = false;
      for (const candidate of [...ordered]) {
        const candidateIndex = files.findIndex((file) => file.cacheId === candidate.cacheId);
        if (candidateIndex === -1) continue;
        const candidateLock = await acquireLock(
          lockProvider,
          `${lockProvider.namespace}:${candidate.cacheId}`,
          undefined,
          Date.now() + 5_000,
        ).catch(() => null);
        if (!candidateLock) continue;
        try {
          if (await activeUsageLeaseExists(cacheDir, candidate.cacheId)) continue;
          await Promise.all([
            fs.promises.rm(candidate.mediaPath, { force: true }),
            fs.promises.rm(candidate.manifestPath, { force: true }),
            fs.promises.rm(path.join(cacheDir, '.leases', candidate.cacheId), { recursive: true, force: true }),
          ]);
          files = files.filter((file) => file.cacheId !== candidate.cacheId);
          evicted = true;
          break;
        } finally {
          await candidateLock.release();
        }
      }
      if (!evicted) throw new Error('Local video cache is full and all cached videos are currently in use.');
    }

    const { availableBytes } = await getDiskStats(cacheDir);
    if (availableBytes - requiredBytes < minFreeBytes) {
      throw new Error('Insufficient local disk space to cache this video safely.');
    }

    const reservationDirectory = path.join(cacheDir, '.reservations');
    await fs.promises.mkdir(reservationDirectory, { recursive: true });
    const reservationPath = path.join(reservationDirectory, randomUUID());
    await fs.promises.writeFile(reservationPath, JSON.stringify({ bytes: requiredBytes }), { flag: 'wx', mode: 0o600 });
    return { reservationPath };
  } finally {
    await globalLock.release();
  }
}

/**
 * Acquire a verified, shared local cache entry for a remote storage object.
 * The callback downloads to a provided temporary path and must honor its signal.
 * @param {{ redis?: any, lockProvider?: { namespace: string, acquire: Function }, cacheDir: string, identity: unknown, expectedBytes?: number, maxFileBytes?: number, minFreeBytes?: number, signal?: AbortSignal, download: (destinationPath: string, options: { signal?: AbortSignal, onProgress?: (receivedBytes: number, totalBytes?: number) => void }) => Promise<unknown>, verify?: Function, onProgress?: (receivedBytes: number, totalBytes?: number) => void }} options
 */
export async function acquireVideoCache({
  redis,
  lockProvider: providedLockProvider,
  cacheDir,
  identity,
  expectedBytes,
  maxFileBytes = CACHE_MAX_FILE_BYTES,
  minFreeBytes = 1024 * 1024 * 1024,
  signal,
  download,
  verify,
  onProgress,
}) {
  const resolvedCacheDir = path.resolve(cacheDir);
  await fs.promises.mkdir(resolvedCacheDir, { recursive: true, mode: 0o750 });
  const namespace = await ensureCacheNamespace(resolvedCacheDir);
  const lockProvider = providedLockProvider || (redis ? redisCacheLockProvider(redis, namespace) : null);
  if (!lockProvider || typeof lockProvider.namespace !== 'string' || typeof download !== 'function') {
    throw new TypeError('A namespaced cache lock provider and video download callback are required.');
  }
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxFileBytes) {
    throw new Error('The remote video size is unknown or outside the supported cache limit.');
  }

  const cacheId = digest(JSON.stringify({
    provider: identity.provider,
    bucket: identity.bucket,
    objectKey: identity.objectKey,
  }));
  const mediaPath = path.join(resolvedCacheDir, `${cacheId}.media`);
  const manifestPath = path.join(resolvedCacheDir, `${cacheId}.json`);
  const waitUntil = Date.now() + CACHE_WAIT_TIMEOUT_MS;

  while (Date.now() < waitUntil) {
    if (signal?.aborted) throw new Error('Video cache operation was cancelled.');
    const cacheLock = await acquireLock(lockProvider, `${lockProvider.namespace}:${cacheId}`, signal, waitUntil);
    let reservationPath = null;
    let reservationHeartbeat = null;
    let usageLease = null;
    try {
      let manifest = await readVerifiedCache(mediaPath, manifestPath, cacheId, expectedBytes, identity);
      let cacheHit = Boolean(manifest);
      if (!manifest) {
        const reservation = await makeRoom({
          lockProvider,
          cacheDir: resolvedCacheDir,
          requiredBytes: expectedBytes,
          protectedCacheId: cacheId,
          minFreeBytes,
        });
        reservationPath = reservation.reservationPath;
        reservationHeartbeat = setInterval(() => {
          const now = new Date();
          void fs.promises.utimes(reservationPath, now, now).catch(() => {});
        }, Math.floor(CACHE_LOCK_TTL_MS / 3));
        reservationHeartbeat.unref?.();
        const stagingPath = `${mediaPath}.part-${randomUUID()}`;
        const controller = new AbortController();
        const abortDownload = () => controller.abort();
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener('abort', abortDownload, { once: true });
        const stopOnLeaseLoss = () => controller.abort();
        cacheLock.onLost(stopOnLeaseLoss);
        let downloadSlot = null;
        let unsubscribeSlotLoss = null;
        try {
          downloadSlot = await acquireDownloadSlot(lockProvider, controller.signal);
          unsubscribeSlotLoss = downloadSlot.onLost(() => controller.abort());
          await download(stagingPath, { signal: controller.signal, onProgress });
          if (controller.signal.aborted || cacheLock.lost) throw new Error('Video cache ownership was lost during download.');
          const stat = await fs.promises.stat(stagingPath);
          if (!stat.isFile() || stat.size !== expectedBytes) throw new Error('The downloaded video failed its size integrity check.');
          const mediaMetadata = verify ? await verify(stagingPath) : null;
          if (verify && (!mediaMetadata || typeof mediaMetadata.codecName !== 'string'
            || !Number.isInteger(mediaMetadata.width) || !Number.isInteger(mediaMetadata.height))) {
            throw new Error('The downloaded video failed media metadata verification.');
          }
          const sha256 = await hashFile(stagingPath);
          await fs.promises.rm(mediaPath, { force: true });
          await fs.promises.rm(manifestPath, { force: true });
          await fs.promises.rename(stagingPath, mediaPath);
          manifest = {
            version: CACHE_MANIFEST_VERSION,
            cacheId,
            sizeBytes: stat.size,
            sha256,
            sourceEtag: identity.etag || null,
            sourceLastModified: identity.lastModified || null,
            mediaMetadata,
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
          };
          await writeJsonAtomically(manifestPath, manifest);
        } catch (error) {
          await fs.promises.rm(stagingPath, { force: true }).catch(() => {});
          await fs.promises.rm(mediaPath, { force: true }).catch(() => {});
          await fs.promises.rm(manifestPath, { force: true }).catch(() => {});
          throw error;
        } finally {
          unsubscribeSlotLoss?.();
          await downloadSlot?.release();
          signal?.removeEventListener('abort', abortDownload);
        }
        await fs.promises.rm(reservationPath, { force: true });
        reservationPath = null;
        clearInterval(reservationHeartbeat);
        reservationHeartbeat = null;
      } else {
        manifest.lastAccessedAt = Date.now();
        await writeJsonAtomically(manifestPath, manifest);
      }

      usageLease = await createUsageLease(resolvedCacheDir, cacheId);
      const result = {
        path: mediaPath,
        cacheId,
        cacheHit,
        sizeBytes: manifest.sizeBytes,
        sha256: manifest.sha256,
        mediaMetadata: manifest.mediaMetadata || null,
        release: usageLease.release,
      };
      usageLease = null;
      return result;
    } finally {
      clearInterval(reservationHeartbeat);
      if (reservationPath) await fs.promises.rm(reservationPath, { force: true }).catch(() => {});
      if (usageLease) await usageLease.release();
      await cacheLock.release();
    }
  }
  throw new Error('Timed out waiting for the local video cache.');
}

/**
 * Remove incomplete download files left by workers that crashed mid-transfer.
 * @param {string} cacheDir
 * @param {{ redis?: any, lockProvider?: { namespace: string, acquire: Function }, olderThanMs?: number }} [options]
 * @returns {Promise<number>}
 */
export async function cleanupOrphanedVideoCacheFiles(cacheDir, { redis, lockProvider: providedLockProvider, olderThanMs = 60 * 60 * 1000 } = {}) {
  const resolvedCacheDir = path.resolve(cacheDir);
  await fs.promises.mkdir(resolvedCacheDir, { recursive: true, mode: 0o750 });
  const namespace = await ensureCacheNamespace(resolvedCacheDir);
  const lockProvider = providedLockProvider || (redis ? redisCacheLockProvider(redis, namespace) : null);
  if (lockProvider && typeof lockProvider.namespace !== 'string') {
    throw new TypeError('A namespaced cache lock provider is required.');
  }
  const entries = await fs.promises.readdir(resolvedCacheDir, { withFileTypes: true });
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isPartial = entry.name.includes('.part-');
    const isCacheFile = entry.name.endsWith('.media') || entry.name.endsWith('.json');
    const cacheIdMatch = /^([a-f0-9]{64})\./.exec(entry.name);
    const cacheId = cacheIdMatch?.[1] || null;
    if (!isPartial && !isCacheFile) continue;
    const filePath = path.join(resolvedCacheDir, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      let orphanedCacheFile = false;
      if (isCacheFile && stat.mtimeMs < cutoff) {
        const cacheId = entry.name.replace(/\.(?:media|json)$/, '');
        const otherPath = path.join(resolvedCacheDir, `${cacheId}${entry.name.endsWith('.media') ? '.json' : '.media'}`);
        try {
          await fs.promises.access(otherPath);
        } catch (error) {
          if (error.code === 'ENOENT') orphanedCacheFile = true;
          else throw error;
        }
      }
      if (isPartial && stat.mtimeMs < cutoff || orphanedCacheFile) {
        const lock = lockProvider && cacheId
          ? await acquireLock(lockProvider, `${lockProvider.namespace}:${cacheId}`, undefined, Date.now() + 1000).catch(() => null)
          : null;
        if (lockProvider && cacheId && !lock) continue;
        try {
          if (cacheId && await activeUsageLeaseExists(resolvedCacheDir, cacheId)) continue;
          await fs.promises.rm(filePath, { force: true });
          removed++;
        } finally {
          await lock?.release();
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

export async function getVideoCacheStats(cacheDir) {
  const resolvedCacheDir = path.resolve(cacheDir);
  await fs.promises.mkdir(resolvedCacheDir, { recursive: true, mode: 0o750 });
  const [{ totalBytes, availableBytes }, entries] = await Promise.all([
    getDiskStats(resolvedCacheDir),
    listCacheEntries(resolvedCacheDir),
  ]);
  return {
    diskTotalBytes: totalBytes,
    diskAvailableBytes: availableBytes,
    cachedVideoBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    cachedVideoCount: entries.length,
  };
}
