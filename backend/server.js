/**
 * StreamPulse - Express API Gateway
 * Handles stream lifecycle dispatch, BullMQ job enqueueing, graceful FFmpeg process termination,
 * and 1-Click Admin Performance Scaling without container restarts.
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { streamQueue, redisClient } from './queue.js';
import { supabase } from './supabase.js';
import { getStorageProvider, STORAGE_PROVIDER } from './storage.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Locate production React/Vite build directory (dist)
const candidateDistPaths = [
  path.resolve(process.cwd(), 'dist'),
  path.resolve(__dirname, '../dist'),
  path.resolve(__dirname, 'dist'),
];
export const distPath = candidateDistPaths.find(
  (p) => fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))
);

if (distPath) {
  console.log(`[StreamPulse UI] Serving production frontend from: ${distPath}`);
  app.use(express.static(distPath, { maxAge: '1d' }));
} else {
  console.log('[StreamPulse UI] No dist folder found; running in standalone API mode.');
}

// ----------------------------------------------------------------------------
// Health Check Endpoint (Resilient for Docker, Coolify & Orchestration Probes)
// Always returns HTTP 200 OK when Express is alive and accepting connections
// ----------------------------------------------------------------------------
const handleHealthCheck = async (_req, res) => {
  let redisStatus = 'connecting';
  let queueCounts = null;

  try {
    // Quick, non-blocking check with 1.5s timeout to prevent hanging health probes
    const pingPromise = redisClient ? redisClient.ping() : Promise.resolve('DISCONNECTED');
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 1500));
    const pingResult = await Promise.race([pingPromise, timeoutPromise]);
    redisStatus = pingResult === 'PONG' ? 'connected' : pingResult === 'TIMEOUT' ? 'slow' : 'standby';

    if (redisStatus === 'connected' && streamQueue) {
      queueCounts = await Promise.race([
        streamQueue.getJobCounts(),
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
    }
  } catch (err) {
    redisStatus = 'initializing';
  }

  const mem = process.memoryUsage();
  return res.status(200).json({
    status: 'healthy',
    ready: true,
    node: process.version,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      rssMb: +(mem.rss / (1024 * 1024)).toFixed(1),
      heapMb: +(mem.heapUsed / (1024 * 1024)).toFixed(1),
    },
    services: {
      api: 'operational',
      redis: redisStatus,
      queue: queueCounts || 'active',
      storage: process.env.STORAGE_PROVIDER || 'supabase',
    },
  });
};

app.get('/health', handleHealthCheck);
app.get('/healthz', handleHealthCheck);
app.get('/api/health', handleHealthCheck);
app.head('/health', (_req, res) => res.status(200).end());
app.head('/healthz', (_req, res) => res.status(200).end());

// ----------------------------------------------------------------------------
// Root Route (GET /) - StreamPulse React UI & Operational Status
// Serves interactive client dashboard when dist/ is built, or JSON/HTML fallback
// ----------------------------------------------------------------------------
app.get('/', (req, res) => {
  // If production React frontend is built, serve full interactive UI!
  if (distPath && (!req.headers.accept || !req.headers.accept.includes('application/json'))) {
    return res.sendFile(path.join(distPath, 'index.html'));
  }

  // If JSON is requested (curl or API clients)
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(200).json({
      name: 'StreamPulse 24/7 Live Streaming API Gateway',
      status: 'operational',
      version: '1.0.0',
      node: process.version,
      uptime_seconds: Math.floor(process.uptime()),
      endpoints: {
        health: '/health',
        api_health: '/api/health',
        storage_status: '/api/storage/status',
        streams: '/api/streams',
      },
      documentation: 'https://streampulse.io',
      timestamp: new Date().toISOString(),
    });
  }

  // Interactive HTML status dashboard for browser visits
  const uptimeMinutes = (process.uptime() / 60).toFixed(1);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StreamPulse API Gateway &bull; Operational</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #090d16;
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 1.25rem;
      max-width: 580px;
      width: 100%;
      padding: 2.25rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px -10px rgba(16, 185, 129, 0.1);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.35);
      color: #34d399;
      font-size: 0.8125rem;
      font-weight: 700;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      margin-bottom: 1.25rem;
    }
    .pulse {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 10px #10b981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.3); }
    }
    h1 { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.025em; margin-bottom: 0.5rem; color: #ffffff; }
    p.lead { color: #94a3b8; font-size: 0.9375rem; line-height: 1.5; margin-bottom: 1.5rem; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 0.875rem;
      padding: 1rem;
      margin-bottom: 1.5rem;
    }
    .metric-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }
    .metric-val { font-size: 0.9375rem; font-weight: 700; color: #f8fafc; margin-top: 0.2rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .links-title { font-size: 0.8125rem; font-weight: 700; color: #cbd5e1; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .links-grid { display: flex; flex-direction: column; gap: 0.5rem; }
    .link-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #1e293b;
      border: 1px solid #334155;
      padding: 0.7rem 1rem;
      border-radius: 0.625rem;
      color: #38bdf8;
      text-decoration: none;
      font-size: 0.875rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      transition: all 0.2s;
    }
    .link-item:hover { background: #334155; border-color: #38bdf8; color: #ffffff; }
    .tag { font-size: 0.7rem; color: #94a3b8; background: #0f172a; padding: 0.2rem 0.5rem; border-radius: 0.375rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <span class="pulse"></span>
      API GATEWAY ONLINE
    </div>
    <h1>StreamPulse 24/7 Live</h1>
    <p class="lead">Autonomous High-Availability 24/7 YouTube Streaming Backend Engine. All system routes and endpoints are operational.</p>
    
    <div class="metrics">
      <div>
        <div class="metric-label">Uptime</div>
        <div class="metric-val">${uptimeMinutes} mins</div>
      </div>
      <div>
        <div class="metric-label">Node Runtime</div>
        <div class="metric-val">${process.version}</div>
      </div>
      <div>
        <div class="metric-label">Status</div>
        <div class="metric-val" style="color: #34d399;">200 OK</div>
      </div>
      <div>
        <div class="metric-label">Storage</div>
        <div class="metric-val" style="text-transform: uppercase;">${process.env.STORAGE_PROVIDER || 'Supabase'}</div>
      </div>
    </div>

    <div class="links-title">Quick Endpoints</div>
    <div class="links-grid">
      <a href="/health" class="link-item">
        <span>GET /health</span>
        <span class="tag">Container Health</span>
      </a>
      <a href="/api/health" class="link-item">
        <span>GET /api/health</span>
        <span class="tag">Cluster Metrics</span>
      </a>
      <a href="/api/storage/status" class="link-item">
        <span>GET /api/storage/status</span>
        <span class="tag">Storage Vault</span>
      </a>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
});

// ----------------------------------------------------------------------------
// Storage Provider Status & Dynamic Switch (Supabase vs Cloudflare R2)
// ----------------------------------------------------------------------------
app.get('/api/storage/status', (req, res) => {
  const provider = getStorageProvider();
  return res.status(200).json({
    status: 'healthy',
    activeProvider: provider.name,
    bucket: provider.bucket,
    supportedProviders: ['supabase', 'r2'],
    isR2Ready: Boolean(process.env.CLOUDFLARE_R2_ACCOUNT_ID && process.env.CLOUDFLARE_R2_ACCESS_KEY_ID),
    isSupabaseReady: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
});

app.post('/api/storage/switch', (req, res) => {
  const { provider } = req.body;
  if (!provider || !['supabase', 'r2'].includes(provider.toLowerCase())) {
    return res.status(400).json({ success: false, error: "Supported providers are 'supabase' and 'r2'" });
  }
  process.env.STORAGE_PROVIDER = provider.toLowerCase();
  const newProvider = getStorageProvider(provider.toLowerCase());
  return res.status(200).json({
    success: true,
    message: `Switched active storage provider to ${newProvider.name}`,
    activeProvider: newProvider.name,
    bucket: newProvider.bucket,
  });
});

// ----------------------------------------------------------------------------
// 1. POST /api/streams/start
// Validates stream record, enforces user quota, enqueues BullMQ worker job.
// ----------------------------------------------------------------------------
app.post('/api/streams/start', async (req, res) => {
  try {
    const { streamId, userId } = req.body;

    if (!streamId) {
      return res.status(400).json({ success: false, error: 'streamId is required' });
    }

    console.log(`[API Gateway] Received stream start request for streamId: ${streamId}`);

    // Fetch stream details from Supabase
    const { data: stream, error: streamError } = await supabase
      .from('streams')
      .select('id, user_id, title, video_url, stream_key, rtmp_server_url, status, is_looping, direct_copy_mode, orientation, category, audience, thumbnail_url, visibility, scheduled_for')
      .eq('id', streamId)
      .single();

    if (streamError || !stream) {
      return res.status(404).json({ success: false, error: 'Stream not found in database' });
    }

    // Verify ownership if userId is supplied in auth header / body
    if (userId && stream.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized access to stream' });
    }

    // Check if stream is already running or queued
    if (['queued', 'starting', 'live'].includes(stream.status)) {
      return res.status(409).json({
        success: false,
        error: `Stream is already in state: ${stream.status}`,
      });
    }

    // Verify user profile quota
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('max_concurrent_streams, is_banned')
      .eq('id', stream.user_id)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }

    if (profile.is_banned) {
      return res.status(403).json({ success: false, error: 'Account is suspended' });
    }

    // Count currently active streams for this user
    const { count: activeCount } = await supabase
      .from('streams')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', stream.user_id)
      .in('status', ['queued', 'starting', 'live']);

    if ((activeCount || 0) >= profile.max_concurrent_streams) {
      return res.status(429).json({
        success: false,
        error: `Quota exceeded: Active streams (${activeCount}) reached limit of ${profile.max_concurrent_streams}`,
      });
    }

    // Update status to 'queued' in Supabase
    await supabase
      .from('streams')
      .update({
        status: 'queued',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', streamId);

    // Enqueue job into BullMQ
    // Using streamId as jobId guarantees deduplication and idempotency
    const job = await streamQueue.add(
      'start-stream',
      {
        streamId: stream.id,
        userId: stream.user_id,
        title: stream.title,
        videoUrl: stream.video_url,
        thumbnailUrl: stream.thumbnail_url,
        streamKey: stream.stream_key,
        rtmpServerUrl: stream.rtmp_server_url,
        isLooping: stream.is_looping,
        directCopyMode: stream.direct_copy_mode,
        orientation: stream.orientation || 'horizontal',
        category: stream.category || 'Entertainment',
        audience: stream.audience || 'not_for_kids',
        visibility: stream.visibility || 'public',
        scheduledFor: stream.scheduled_for,
      },
      {
        jobId: `stream-${stream.id}`,
        priority: 1,
      }
    );

    console.log(`[BullMQ] Enqueued start job: ${job.id} for stream: ${streamId}`);

    return res.status(200).json({
      success: true,
      message: 'Stream successfully enqueued for isolated worker execution',
      jobId: job.id,
      streamId: stream.id,
      status: 'queued',
    });
  } catch (error) {
    console.error('[API Gateway Start Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 2. POST /api/streams/stop
// Gracefully kills the isolated FFmpeg child process via PID and publishes stop event.
// ----------------------------------------------------------------------------
app.post('/api/streams/stop', async (req, res) => {
  try {
    const { streamId, userId } = req.body;

    if (!streamId) {
      return res.status(400).json({ success: false, error: 'streamId is required' });
    }

    console.log(`[API Gateway] Received stream stop request for streamId: ${streamId}`);

    // Query active process PID & status from Supabase
    const { data: stream, error } = await supabase
      .from('streams')
      .select('id, user_id, ffmpeg_pid, status, worker_node_id')
      .eq('id', streamId)
      .single();

    if (error || !stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }

    if (userId && stream.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized access to stream' });
    }

    // Cancel queued BullMQ job if it hasn't been picked up by a worker yet
    const job = await streamQueue.getJob(`stream-${streamId}`);
    if (job) {
      const state = await job.getState();
      if (['waiting', 'delayed'].includes(state)) {
        await job.remove();
        console.log(`[BullMQ] Removed waiting job stream-${streamId}`);
      }
    }

    // Publish STOP command across Redis Pub/Sub cluster
    // Isolated workers listening on 'stream-control-bus' will kill their local FFmpeg child processes
    await redisClient.publish(
      'stream-control-bus',
      JSON.stringify({
        action: 'STOP',
        streamId,
        ffmpegPid: stream.ffmpeg_pid,
        workerNodeId: stream.worker_node_id,
        timestamp: Date.now(),
      })
    );

    // If worker process is co-located on this host and PID is known, send SIGTERM fallback
    if (stream.ffmpeg_pid) {
      try {
        process.kill(stream.ffmpeg_pid, 'SIGTERM');
        console.log(`[Process Signal] Sent SIGTERM to FFmpeg PID: ${stream.ffmpeg_pid}`);
      } catch (err) {
        // PID might belong to a different container node or already exited
        console.log(`[Process Signal Notice] Local PID kill notice: ${err.message}`);
      }
    }

    // Update stream status in database
    await supabase
      .from('streams')
      .update({
        status: 'idle',
        ffmpeg_pid: null,
        current_bitrate_kbps: 0,
        fps: 0,
        last_stopped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', streamId);

    return res.status(200).json({
      success: true,
      message: 'Stream stopped successfully. FFmpeg worker terminated.',
      streamId,
      status: 'idle',
    });
  } catch (error) {
    console.error('[API Gateway Stop Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------------------------------
// 3. POST /api/admin/scale
// 1-Click Dynamic Scaling: Updates concurrency & Redis caching without restarts!
// ----------------------------------------------------------------------------
app.post('/api/admin/scale', async (req, res) => {
  try {
    const {
      workerConcurrency,
      redisCacheTtlSeconds,
      maxGlobalStreams,
      bullmqRateLimitMax,
      heartbeatTimeoutSeconds,
      enforceDirectCopyMode,
      clusterMode,
    } = req.body;

    // Validate inputs
    const concurrency = parseInt(workerConcurrency, 10);
    if (isNaN(concurrency) || concurrency < 1 || concurrency > 256) {
      return res.status(400).json({
        success: false,
        error: 'workerConcurrency must be an integer between 1 and 256',
      });
    }

    console.log(`[Admin Scaler] Applying dynamic cluster scaling. New concurrency: ${concurrency}`);

    const payload = {
      worker_concurrency: concurrency,
      last_scaled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (redisCacheTtlSeconds !== undefined) {
      payload.redis_cache_ttl_seconds = Math.max(10, parseInt(redisCacheTtlSeconds, 10));
    }
    if (maxGlobalStreams !== undefined) {
      payload.max_global_streams = parseInt(maxGlobalStreams, 10);
    }
    if (bullmqRateLimitMax !== undefined) {
      payload.bullmq_rate_limit_max = parseInt(bullmqRateLimitMax, 10);
    }
    if (heartbeatTimeoutSeconds !== undefined) {
      payload.heartbeat_timeout_seconds = parseInt(heartbeatTimeoutSeconds, 10);
    }
    if (enforceDirectCopyMode !== undefined) {
      payload.enforce_direct_copy_mode = Boolean(enforceDirectCopyMode);
    }
    if (clusterMode) {
      payload.cluster_mode = clusterMode;
    }

    // 1. Update Supabase system_settings singleton record
    const { data: updatedSettings, error } = await supabase
      .from('system_settings')
      .update(payload)
      .eq('id', 'primary_cluster')
      .select()
      .single();

    if (error) {
      console.error('[Supabase Scaling Update Error]', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // 2. Cache updated settings into Redis with TTL
    await redisClient.set(
      'system_settings:primary_cluster',
      JSON.stringify(updatedSettings),
      'EX',
      payload.redis_cache_ttl_seconds || 300
    );

    // 3. Broadcast real-time scaling event over Redis channel
    // All active BullMQ worker nodes will subscribe and update worker.concurrency in RAM immediately
    await redisClient.publish(
      'cluster-scaling-events',
      JSON.stringify({
        event: 'DYNAMIC_SCALE',
        workerConcurrency: concurrency,
        settings: updatedSettings,
        timestamp: Date.now(),
      })
    );

    console.log('[Admin Scaler] Dynamic scaling broadcast dispatched successfully.');

    return res.status(200).json({
      success: true,
      message: '1-Click dynamic performance scaling applied without container redeployment.',
      settings: updatedSettings,
    });
  } catch (error) {
    console.error('[API Gateway Scale Error]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------------------------------
// Client-Side Routing Fallback (SPA Browser Navigation)
// Routes /live-studio, /billing, /channels, etc. to index.html without breaking /api
// ----------------------------------------------------------------------------
app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/health') ||
    req.path.startsWith('/ws')
  ) {
    return next();
  }
  if (distPath) {
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  return res.redirect('/');
});

// Start Express Listener
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`StreamPulse API Gateway running on port ${PORT}`);
  console.log(`- POST /api/streams/start`);
  console.log(`- POST /api/streams/stop`);
  console.log(`- POST /api/admin/scale`);
  console.log(`- GET  /health`);
  console.log(`=======================================================`);
});

export default app;
