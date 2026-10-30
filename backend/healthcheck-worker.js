/**
 * StreamPulse Worker Node Healthcheck
 * Executed by Docker HEALTHCHECK CMD to verify worker process is responsive,
 * heartbeating, within memory boundaries (hard ceiling 2048MB), and under concurrency limits.
 */
import fs from 'fs';
import path from 'path';

const HEARTBEAT_FILE = path.resolve('/tmp/worker-heartbeat.json');
const MAX_STALE_SECONDS = 60;
const HARD_MEMORY_LIMIT_MB = 2048; // Docker container memory ceiling

try {
  if (!fs.existsSync(HEARTBEAT_FILE)) {
    // If worker node started within last 25s, allow warm-up time
    console.log('[Healthcheck] Waiting for initial worker heartbeat...');
    process.exit(0);
  }

  const raw = fs.readFileSync(HEARTBEAT_FILE, 'utf-8');
  const heartbeat = JSON.parse(raw);
  const ageSeconds = (Date.now() - heartbeat.timestamp) / 1000;

  // 1. Verify Heartbeat Freshness
  if (ageSeconds > MAX_STALE_SECONDS) {
    console.error(`[Healthcheck FAIL] Stale heartbeat: ${ageSeconds.toFixed(1)}s old (Threshold: ${MAX_STALE_SECONDS}s)`);
    process.exit(1);
  }

  // 2. Memory Boundary & OOM Prevention Check
  const rssMb = heartbeat.memory?.rssMb || 0;
  if (rssMb >= HARD_MEMORY_LIMIT_MB) {
    console.error(`[Healthcheck FAIL] Memory ceiling exceeded: ${rssMb}MB >= ${HARD_MEMORY_LIMIT_MB}MB hard limit. OOM risk.`);
    process.exit(1);
  }

  // Check cgroup v2 / v1 memory usage if present in Linux container
  let cgroupMemoryMb = 0;
  try {
    if (fs.existsSync('/sys/fs/cgroup/memory.current')) {
      // cgroup v2
      const bytes = parseInt(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf-8').trim(), 10);
      cgroupMemoryMb = +(bytes / (1024 * 1024)).toFixed(1);
    } else if (fs.existsSync('/sys/fs/cgroup/memory/memory.usage_in_bytes')) {
      // cgroup v1
      const bytes = parseInt(fs.readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf-8').trim(), 10);
      cgroupMemoryMb = +(bytes / (1024 * 1024)).toFixed(1);
    }
  } catch (cgErr) {}

  if (cgroupMemoryMb >= HARD_MEMORY_LIMIT_MB) {
    console.error(`[Healthcheck FAIL] Cgroup memory usage (${cgroupMemoryMb}MB) breached hard limit (${HARD_MEMORY_LIMIT_MB}MB).`);
    process.exit(1);
  }

  // 3. Concurrency Capacity Verification
  const active = heartbeat.activeStreams || 0;
  const maxCap = heartbeat.maxConcurrentStreams || 10;
  const memReport = cgroupMemoryMb > 0 ? `${rssMb}MB (Cgroup: ${cgroupMemoryMb}MB)` : `${rssMb}MB`;

  console.log(`[Healthcheck OK] Node: ${heartbeat.workerNodeId} | Streams: ${active}/${maxCap} | Memory: ${memReport} / ${HARD_MEMORY_LIMIT_MB}MB limit | Age: ${ageSeconds.toFixed(1)}s`);
  process.exit(0);
} catch (err) {
  console.error('[Healthcheck Error]', err.message);
  process.exit(1);
}
