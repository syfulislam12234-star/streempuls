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

// ----------------------------------------------------------------------------
// Local JSON Data Persistence (same data layer as root server.ts)
// Preserves existing user accounts, referrals, notifications, and earnings.
// Data files live in ../data/ relative to backend/ directory.
// ----------------------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const PROMOCODES_FILE = path.join(DATA_DIR, 'promocodes.json');
const WITHDRAWALS_FILE = path.join(DATA_DIR, 'withdrawals.json');
const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readLocalUsers() {
  ensureDataDir();
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {}
  return [];
}

function writeLocalUsers(users) {
  ensureDataDir();
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8'); } catch (e) {}
}

function readLocalNotifications() {
  ensureDataDir();
  try {
    if (fs.existsSync(NOTIFICATIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {}
  return [];
}

function writeLocalNotifications(notifications) {
  ensureDataDir();
  try { fs.writeFileSync(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2), 'utf-8'); } catch (e) {}
}

function readLocalPromoCodes() {
  ensureDataDir();
  try {
    if (fs.existsSync(PROMOCODES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROMOCODES_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {}
  return [];
}

function writeLocalPromoCodes(codes) {
  ensureDataDir();
  try { fs.writeFileSync(PROMOCODES_FILE, JSON.stringify(codes, null, 2), 'utf-8'); } catch (e) {}
}

function readLocalWithdrawals() {
  ensureDataDir();
  try {
    if (fs.existsSync(WITHDRAWALS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {}
  return [];
}

function writeLocalWithdrawals(withdrawals) {
  ensureDataDir();
  try { fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(withdrawals, null, 2), 'utf-8'); } catch (e) {}
}

function readLocalCoupons() {
  ensureDataDir();
  try {
    if (fs.existsSync(COUPONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(COUPONS_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {}
  return [];
}

function readLocalPayments() {
  ensureDataDir();
  try {
    if (fs.existsSync(PAYMENTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {}
  return [];
}

function getTierConfig(tier) {
  switch (tier) {
    case 'free':
      return { channel_limit: 1, video_limit: 1, duration_days: 3, hour_limit: 10, has_watermark: true, is_brand_free: false, price_bdt: 0 };
    case 'basic':
      return { channel_limit: 1, video_limit: 1, duration_days: 30, hour_limit: undefined, has_watermark: false, is_brand_free: true, price_bdt: 1200 };
    case 'pro':
      return { channel_limit: 2, video_limit: 2, duration_days: 30, hour_limit: undefined, has_watermark: false, is_brand_free: true, price_bdt: 4000 };
    case 'business':
      return { channel_limit: 4, video_limit: 4, duration_days: 30, hour_limit: undefined, has_watermark: false, is_brand_free: true, price_bdt: 12000 };
    default:
      return { channel_limit: 1, video_limit: 1, duration_days: 3, hour_limit: 10, has_watermark: true, is_brand_free: false, price_bdt: 0 };
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Locate production React/Vite build directory (dist) across container structures
const candidateDistPaths = [
  path.resolve(process.cwd(), 'dist'),
  path.resolve(__dirname, '../dist'),
  path.resolve(__dirname, 'dist'),
  path.resolve('/app/dist'),
  path.resolve('/app/applet/dist'),
];

export function getDistIndexPath() {
  for (const p of candidateDistPaths) {
    const indexPath = path.join(p, 'index.html');
    if (fs.existsSync(indexPath)) {
      return { distDir: p, indexPath };
    }
  }
  return null;
}

// Automatically mount static asset handlers for all discovered dist directories
let mountedCount = 0;
for (const p of candidateDistPaths) {
  if (fs.existsSync(p)) {
    console.log(`[StreamPulse UI] Mounting static assets from: ${p}`);
    app.use(express.static(p, { maxAge: '1d' }));
    mountedCount++;
  }
}
if (mountedCount === 0) {
  console.log('[StreamPulse UI] Notice: dist folder not yet created; will be resolved dynamically on build completion.');
}

// Resolve the production dist directory for SPA client-side routing fallback.
// getDistIndexPath() scans candidateDistPaths and returns { distDir, indexPath } or null.
const distInfo = getDistIndexPath();
const distPath = distInfo ? distInfo.distDir : null;

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
// ----------------------------------------------------------------------------
// Root Route (GET /) - StreamPulse React UI Integration
// Mandatory: Always serves full interactive frontend (dist/index.html)
// ----------------------------------------------------------------------------
app.get('/', (req, res) => {
  const resolved = getDistIndexPath();
  if (resolved) {
    return res.sendFile(resolved.indexPath);
  }
  return res.status(200).json({
    status: 'initializing',
    message: 'StreamPulse frontend is compiling or initializing. Please refresh in a moment.',
  });
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

// ============================================================================
// A. AUTHENTICATION ROUTES (/api/auth)
// ============================================================================

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const users = readLocalUsers();
    const existing = users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(400).json({ success: false, error: 'User already exists with this email address' });
    }

    const tierConfig = getTierConfig('free');
    const newProfile = {
      id: crypto.randomUUID(),
      email: cleanEmail,
      password: password || 'password123',
      full_name: full_name?.trim() || cleanEmail.split('@')[0],
      role: 'user',
      subscription_tier: 'free',
      subscription_status: 'unpaid',
      ...tierConfig,
      referral_code: `PULSE-${cleanEmail.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'USER'}-${Math.floor(1000 + Math.random() * 9000)}`,
      reward_credits_bdt: 0,
      trial_days_bonus: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (supabase) {
      try { await supabase.from('profiles').insert(newProfile); } catch (e) {}
    }

    users.unshift(newProfile);
    writeLocalUsers(users);

    const { password: _, ...safeProfile } = newProfile;
    return res.status(201).json({
      success: true,
      user: safeProfile,
      message: 'Account registered successfully. Subscription status defaults to unpaid.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const users = readLocalUsers();
    let user = users.find((u) => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      const tierConfig = getTierConfig('free');
      user = {
        id: crypto.randomUUID(),
        email: cleanEmail,
        password: password || 'password123',
        full_name: cleanEmail.split('@')[0],
        role: 'user',
        subscription_tier: 'free',
        subscription_status: 'unpaid',
        ...tierConfig,
        referral_code: `PULSE-${cleanEmail.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'USER'}-${Math.floor(1000 + Math.random() * 9000)}`,
        reward_credits_bdt: 0,
        trial_days_bonus: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      users.unshift(user);
      writeLocalUsers(users);
    }

    const { password: _, ...safeUser } = user;
    return res.status(200).json({
      success: true,
      user: safeUser,
      message: `Signed in as ${user.email}. Subscription status: ${user.subscription_status}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const users = readLocalUsers();
    let user = userId ? users.find((u) => u.id === userId) : null;
    if (!user && users.length > 0) {
      user = users[0];
    }
    if (user) {
      const { password, ...safeUser } = user;
      return res.status(200).json({ success: true, user: safeUser });
    }
    return res.status(404).json({ success: false, error: 'No user session found' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
// POST /api/subscription/select-plan
app.post('/api/subscription/select-plan', async (req, res) => {
  try {
    const { userId, planTier } = req.body;
    if (!userId || !planTier) {
      return res.status(400).json({ success: false, error: 'userId and planTier are required' });
    }

    const validTiers = ['free', 'basic', 'pro', 'business'];
    if (!validTiers.includes(planTier)) {
      return res.status(400).json({ success: false, error: `Invalid planTier. Must be one of: ${validTiers.join(', ')}` });
    }

    const users = readLocalUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }

    const tierConfig = getTierConfig(planTier);
    const durationDaysWithBonus = tierConfig.duration_days + (users[idx].trial_days_bonus || 0);
    const expiresAt = new Date(Date.now() + durationDaysWithBonus * 24 * 3600 * 1000).toISOString();

    const updatedUser = {
      ...users[idx],
      subscription_tier: planTier,
      subscription_status: 'active',
      expires_at: expiresAt,
      ...tierConfig,
      duration_days: durationDaysWithBonus,
      updated_at: new Date().toISOString(),
    };

    users[idx] = updatedUser;
    writeLocalUsers(users);

    if (supabase) {
      try { await supabase.from('profiles').update(updatedUser).eq('id', userId); } catch (e) {}
    }

    const notifications = readLocalNotifications();
    notifications.unshift({
      id: crypto.randomUUID(),
      user_id: updatedUser.id,
      title: '🎉 Plan Activated',
      message: `Your ${planTier.toUpperCase()} plan is active for ${durationDaysWithBonus} days. Automated broadcasting studio unlocked!`,
      type: 'system',
      is_read: false,
      created_at: new Date().toISOString(),
    });
    writeLocalNotifications(notifications);

    const { password, ...safeUser } = updatedUser;
    return res.status(200).json({
      success: true,
      user: safeUser,
      message: `${planTier.toUpperCase()} plan activated successfully! Dashboard unlocked.`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/subscription/checkout
app.post('/api/subscription/checkout', async (req, res) => {
  try {
    const { userId, planTier, paymentMethod, couponCode, useReferralCredits } = req.body;
    if (!userId || !planTier) {
      return res.status(400).json({ success: false, error: 'userId and planTier are required' });
    }

    const validTiers = ['free', 'basic', 'pro', 'business'];
    if (!validTiers.includes(planTier)) {
      return res.status(400).json({ success: false, error: 'Invalid plan tier' });
    }

    const users = readLocalUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }

    const user = users[idx];
    const tierConfig = getTierConfig(planTier);
    let originalPrice = tierConfig.price_bdt;
    let discountBdt = 0;
    let appliedCoupon = null;

    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const cleanCode = couponCode.trim().toUpperCase();
      const coupons = readLocalCoupons();
      const match = coupons.find((c) => c.code.toUpperCase() === cleanCode && c.is_active);
      if (match && (!match.applicable_tiers || match.applicable_tiers.includes(planTier))) {
        appliedCoupon = match;
        if (match.discount_type === 'percent') {
          discountBdt = Math.round((originalPrice * match.discount_value) / 100);
        } else {
          discountBdt = Math.min(originalPrice, match.discount_value);
        }
        match.times_used = (match.times_used || 0) + 1;
        writeLocalCoupons(coupons);
      }
    }

    let finalAmount = Math.max(0, originalPrice - discountBdt);

    let creditsUsed = 0;
    if (useReferralCredits && (user.reward_credits_bdt ?? 0) > 0) {
      creditsUsed = Math.min(finalAmount, user.reward_credits_bdt ?? 0);
      user.reward_credits_bdt = (user.reward_credits_bdt ?? 0) - creditsUsed;
      finalAmount = Math.max(0, finalAmount - creditsUsed);
    }

    const currentExpiryMs = user.expires_at ? new Date(user.expires_at).getTime() : Date.now();
    const baseMs = Math.max(Date.now(), currentExpiryMs);
    user.expires_at = new Date(baseMs + 30 * 24 * 3600 * 1000).toISOString();
    user.subscription_status = 'active';
    user.updated_at = new Date().toISOString();

    users[idx] = user;
    writeLocalUsers(users);

    if (supabase) {
      try { await supabase.from('profiles').update(user).eq('id', userId); } catch (e) {}
    }

    const notifications = readLocalNotifications();
    notifications.unshift({
      id: crypto.randomUUID(),
      user_id: user.id,
      title: '🎉 Subscription Activated',
      message: `Your ${user.subscription_tier.toUpperCase()} broadcasting plan has been activated. Streams will continue non-stop.`,
      type: 'system',
      is_read: false,
      created_at: new Date().toISOString(),
    });
    writeLocalNotifications(notifications);

    const { password, ...safeUser } = user;
    return res.status(200).json({
      success: true,
      user: safeUser,
      originalAmountBdt: originalPrice,
      discountBdt,
      creditsUsed,
      finalAmountBdt: finalAmount,
      couponApplied: appliedCoupon ? appliedCoupon.code : null,
      message: `${user.subscription_tier.toUpperCase()} plan activated successfully!`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/subscription/renew
app.post('/api/subscription/renew', async (req, res) => {
  try {
    const { userId, couponCode, useReferralCredits } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const users = readLocalUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }

    const user = users[idx];
    const tierConfig = getTierConfig(user.subscription_tier);
    let originalPrice = tierConfig.price_bdt;
    let discountBdt = 0;

    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const cleanCode = couponCode.trim().toUpperCase();
      const coupons = readLocalCoupons();
      const match = coupons.find((c) => c.code.toUpperCase() === cleanCode && c.is_active);
      if (match && (!match.applicable_tiers || match.applicable_tiers.includes(user.subscription_tier))) {
        if (match.discount_type === 'percent') {
          discountBdt = Math.round((originalPrice * match.discount_value) / 100);
        } else {
          discountBdt = Math.min(originalPrice, match.discount_value);
        }
        match.times_used = (match.times_used || 0) + 1;
        writeLocalCoupons(coupons);
      }
    }

    let finalAmount = Math.max(0, originalPrice - discountBdt);

    let creditsUsed = 0;
    if (useReferralCredits && (user.reward_credits_bdt ?? 0) > 0) {
      creditsUsed = Math.min(finalAmount, user.reward_credits_bdt ?? 0);
      user.reward_credits_bdt = (user.reward_credits_bdt ?? 0) - creditsUsed;
      finalAmount = Math.max(0, finalAmount - creditsUsed);
    }

    const currentExpiryMs = user.expires_at ? new Date(user.expires_at).getTime() : Date.now();
    const baseMs = Math.max(Date.now(), currentExpiryMs);
    user.expires_at = new Date(baseMs + 30 * 24 * 3600 * 1000).toISOString();
    user.subscription_status = 'active';
    user.updated_at = new Date().toISOString();

    users[idx] = user;
    writeLocalUsers(users);

    if (supabase) {
      try { await supabase.from('profiles').update(user).eq('id', userId); } catch (e) {}
    }

    const notifications = readLocalNotifications();
    notifications.unshift({
      id: crypto.randomUUID(),
      user_id: user.id,
      title: '🎉 Subscription Renewed for 30 Days',
      message: `Your ${user.subscription_tier.toUpperCase()} broadcasting plan has been renewed. Streams will continue non-stop.`,
      type: 'system',
      is_read: false,
      created_at: new Date().toISOString(),
    });
    writeLocalNotifications(notifications);

    const { password, ...safeUser } = user;
    return res.status(200).json({
      success: true,
      user: safeUser,
      amountBdt: finalAmount,
      discountBdt,
      creditsUsed,
      message: `${user.subscription_tier.toUpperCase()} plan renewed successfully for 30 days!`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/notifications
app.get('/api/notifications', (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const users = readLocalUsers();
    const user = (userId ? users.find((u) => u.id === userId) : null) || users[0];
    if (!user) return res.status(200).json({ success: true, notifications: [], unreadCount: 0 });

    const notifications = readLocalNotifications().filter((n) => n.user_id === user.id);
    const unreadCount = notifications.filter((n) => !n.is_read).length;
    return res.status(200).json({ success: true, notifications, unreadCount });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/notifications/:id/read
app.post('/api/notifications/:id/read', (req, res) => {
  try {
    const { id } = req.params;
    const notifications = readLocalNotifications();
    const notif = notifications.find((n) => n.id === id);
    if (notif) {
      notif.is_read = true;
      writeLocalNotifications(notifications);
    }
    return res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/promocodes/user/:userId
app.get('/api/v1/promocodes/user/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const users = readLocalUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    const isStarterFree = user.subscription_tier === 'free' || user.subscription_status !== 'active';
    const canGenerate = !isStarterFree;
    const tierReason = isStarterFree
      ? 'Starter Free tier is restricted from generating referral promo codes. Upgrade to Creator Pro or Ultra to unlock unique promo code generation, 15% audience discounts, and BDT referral cash earnings!'
      : undefined;

    const rawUsername = user.full_name ? user.full_name.trim().split(' ')[0] : user.email.split('@')[0];
    const cleanUsername = rawUsername.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'CREATOR';

    const allCodes = readLocalPromoCodes();
    let userCodes = allCodes.filter((c) => c.creator_id === userId);

    if (userCodes.length === 0) {
      let candidateCode = `PULSE-${cleanUsername}`;
      if (allCodes.some((c) => c.code.toUpperCase() === candidateCode.toUpperCase())) {
        candidateCode = `PULSE-${cleanUsername}-${Math.floor(100 + Math.random() * 900)}`;
      }
      const defaultDiscount = user.subscription_tier === 'business' ? 20 : 15;
      const defaultReward = user.subscription_tier === 'business' ? 600 : 300;

      const permanentPromo = {
        id: `promo-${user.id}`,
        code: candidateCode,
        creator_id: user.id,
        creator_email: user.email,
        creator_name: user.full_name || user.email.split('@')[0],
        creator_tier: user.subscription_tier,
        discount_percent: defaultDiscount,
        reward_bdt_per_use: defaultReward,
        usage_count: 0,
        max_uses: 500,
        is_active: true,
        total_earned_bdt: 0,
        referral_link: `https://streampulse.mooo.com/pricing?ref=${candidateCode}`,
        created_at: new Date().toISOString(),
      };

      allCodes.unshift(permanentPromo);
      writeLocalPromoCodes(allCodes);
      userCodes = [permanentPromo];

      if (user.referral_code !== candidateCode) {
        user.referral_code = candidateCode;
        user.updated_at = new Date().toISOString();
        writeLocalUsers(users);
      }
    } else if (userCodes.length > 1) {
      const primary = userCodes.find((c) => c.code === user.referral_code) || userCodes[0];
      const aggregatedEarnings = userCodes.reduce((sum, c) => sum + (c.total_earned_bdt || 0), 0);
      const aggregatedUses = userCodes.reduce((sum, c) => sum + (c.usage_count || 0), 0);
      primary.total_earned_bdt = aggregatedEarnings;
      primary.usage_count = aggregatedUses;
      primary.is_active = true;
      userCodes = [primary];
    }

    const totalReferralEarnings = userCodes.reduce((sum, c) => sum + (c.total_earned_bdt || 0), 0);
    const totalUses = userCodes.reduce((sum, c) => sum + (c.usage_count || 0), 0);
    const activeCount = userCodes.filter((c) => c.is_active).length;

    return res.status(200).json({
      success: true,
      summary: {
        user_id: user.id,
        user_email: user.email,
        user_tier: user.subscription_tier,
        subscription_status: user.subscription_status,
        can_generate_codes: canGenerate,
        tier_restriction_reason: tierReason,
        total_referral_earnings_bdt: totalReferralEarnings,
        reward_credits_bdt: user.reward_credits_bdt || 0,
        total_referral_uses: totalUses,
        active_codes_count: activeCount,
        promo_codes: userCodes,
        daily_growth_30d: [],
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/promocodes/create
app.post('/api/v1/promocodes/create', (req, res) => {
  try {
    const { userId, customCode, discountPercent } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const users = readLocalUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    if (user.subscription_tier === 'free' || user.subscription_status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Starter Free users cannot create referral promo codes. Please upgrade to Creator Pro or Ultra to unlock affiliate referral codes and cash rewards.',
        requiresUpgrade: true,
        currentTier: user.subscription_tier,
      });
    }

    const allCodes = readLocalPromoCodes();
    const existingPromo = allCodes.find((c) => c.creator_id === userId);
    if (existingPromo) {
      return res.status(200).json({
        success: true,
        promoCode: existingPromo,
        message: `You already have an assigned permanent referral promo code: ${existingPromo.code}.`,
      });
    }

    let finalCode = '';
    if (customCode && typeof customCode === 'string' && customCode.trim().length >= 4) {
      const sanitized = customCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (allCodes.some((c) => c.code === sanitized)) {
        return res.status(400).json({ success: false, error: `Promo code '${sanitized}' is already in use.` });
      }
      finalCode = sanitized;
    } else {
      const tierTag = user.subscription_tier === 'business' ? 'ULTRA' : 'PRO';
      let candidate = '';
      do {
        const rand = Math.floor(1000 + Math.random() * 9000);
        candidate = `PULSE-${tierTag}-${rand}`;
      } while (allCodes.some((c) => c.code === candidate));
      finalCode = candidate;
    }

    const discount = typeof discountPercent === 'number' && discountPercent >= 5 && discountPercent <= 30
      ? discountPercent
      : user.subscription_tier === 'business' ? 20 : 15;
    const rewardBdt = user.subscription_tier === 'business' ? 600 : 300;

    const newPromo = {
      id: `promo-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      code: finalCode,
      creator_id: user.id,
      creator_email: user.email,
      creator_name: user.full_name || user.email.split('@')[0],
      creator_tier: user.subscription_tier,
      discount_percent: discount,
      reward_bdt_per_use: rewardBdt,
      usage_count: 0,
      max_uses: 250,
      is_active: true,
      total_earned_bdt: 0,
      referral_link: `https://streampulse.mooo.com/pricing?ref=${finalCode}`,
      created_at: new Date().toISOString(),
    };

    allCodes.unshift(newPromo);
    writeLocalPromoCodes(allCodes);

    return res.status(201).json({
      success: true,
      promoCode: newPromo,
      message: `Unique promo code ${finalCode} generated successfully!`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/promocodes/withdraw
app.post('/api/v1/promocodes/withdraw', (req, res) => {
  try {
    const { userId, amountBdt, paymentMethod, accountType, accountNumber, accountName, bankName, branchName, routingNumber, notes } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const numAmount = Number(amountBdt);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid withdrawal amount' });
    }

    if (numAmount < 500) {
      return res.status(400).json({
        success: false,
        error: 'Minimum withdrawal amount is 500 BDT.',
      });
    }

    const validMethods = ['bkash', 'nagad', 'rocket', 'bank'];
    if (!paymentMethod || !validMethods.includes(paymentMethod)) {
      return res.status(400).json({ success: false, error: 'Invalid payment method.' });
    }

    if (!accountNumber || !String(accountNumber).trim()) {
      return res.status(400).json({ success: false, error: 'Account or phone number is required' });
    }

    const users = readLocalUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    const currentBalance = user.reward_credits_bdt ?? 0;
    if (currentBalance < numAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient earnings balance. Available: ${currentBalance.toLocaleString()} BDT, Requested: ${numAmount.toLocaleString()} BDT.`,
        availableBalance: currentBalance,
      });
    }

    user.reward_credits_bdt = Math.max(0, currentBalance - numAmount);
    user.updated_at = new Date().toISOString();
    writeLocalUsers(users);

    const cleanAccountNumber = String(accountNumber).trim().replace(/[\s-]/g, '');
    const newWithdrawal = {
      id: `wth-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      user_id: user.id,
      user_email: user.email,
      user_name: user.full_name || user.email.split('@')[0],
      amount_bdt: numAmount,
      payment_method: paymentMethod,
      account_type: accountType,
      account_number: cleanAccountNumber,
      account_name: accountName ? String(accountName).trim() : undefined,
      bank_name: bankName ? String(bankName).trim() : undefined,
      branch_name: branchName ? String(branchName).trim() : undefined,
      routing_number: routingNumber ? String(routingNumber).trim() : undefined,
      status: 'pending',
      notes: notes ? String(notes).trim() : undefined,
      created_at: new Date().toISOString(),
    };

    const withdrawals = readLocalWithdrawals();
    withdrawals.unshift(newWithdrawal);
    writeLocalWithdrawals(withdrawals);

    const notifs = readLocalNotifications();
    notifs.unshift({
      id: `notif-${Date.now()}`,
      user_id: user.id,
      title: 'Withdrawal Request Submitted',
      message: `Your payout request of ${numAmount.toLocaleString()} BDT via ${paymentMethod.toUpperCase()} (${cleanAccountNumber}) has been submitted and is pending verification.`,
      type: 'system',
      is_read: false,
      created_at: new Date().toISOString(),
    });
    writeLocalNotifications(notifs);

    return res.status(201).json({
      success: true,
      withdrawal: newWithdrawal,
      remainingBalanceBdt: user.reward_credits_bdt,
      message: `Withdrawal request of ৳${numAmount.toLocaleString()} BDT submitted successfully.`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/promocodes/withdrawals/:userId
app.get('/api/v1/promocodes/withdrawals/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const allWithdrawals = readLocalWithdrawals();
    const userWithdrawals = allWithdrawals
      .filter((w) => w.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.status(200).json({
      success: true,
      count: userWithdrawals.length,
      withdrawals: userWithdrawals,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
