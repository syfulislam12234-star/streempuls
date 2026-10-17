/**
 * StreamPulse - Express API Gateway
 * Handles stream lifecycle dispatch, BullMQ job enqueueing, graceful FFmpeg process termination,
 * and 1-Click Admin Performance Scaling without container restarts.
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { streamQueue, redisClient } from './queue.js';
import { supabase } from './supabase.js';
import { getStorageProvider, STORAGE_PROVIDER } from './storage.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ----------------------------------------------------------------------------
// Health Check Endpoint
// ----------------------------------------------------------------------------
app.get('/health', async (req, res) => {
  try {
    const redisPing = await redisClient.ping();
    const queueCount = await streamQueue.getJobCounts();

    return res.status(200).json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        redis: redisPing === 'PONG' ? 'connected' : 'degraded',
        bullmq: {
          queue: 'youtube-stream-dispatch',
          counts: queueCount,
        },
      },
    });
  } catch (error) {
    return res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
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
