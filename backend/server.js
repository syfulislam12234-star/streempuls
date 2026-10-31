
import express from 'express';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const STREAMS_FILE = path.join(DATA_DIR, 'streams.json');
const DIST_DIR = path.resolve(__dirname, '../dist');
const PAYMENT_SETTINGS_FILE = path.join(DATA_DIR, 'payment_settings.json');
const SITE_CONTENT_FILE = path.join(DATA_DIR, 'site_content.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const allowedOrigins = (process.env.CORS_ORIGINS || 'https://streempuls.mooo.com,https://www.streempuls.mooo.com,http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-User-Id', 'X-Admin-Api-Key'],
  optionsSuccessStatus: 204,
}));
app.use(express.json());

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

const defaultPaymentSettings = {
  bkash_personal: '01712-345678',
  bkash_merchant: '01987-654321',
  nagad_personal: '01812-345678',
  nagad_merchant: '01612-345678',
  rocket_personal: '01712-345678',
  rocket_merchant: '01987-654321',
  whatsapp_number: '+8801712345678',
};

function readPaymentSettings() {
  return { ...defaultPaymentSettings, ...readJsonFile(PAYMENT_SETTINGS_FILE, {}) };
}

function readSiteContent() {
  return readJsonFile(SITE_CONTENT_FILE, {
    id: 'site_content',
    terms_of_service: 'StreamPulse Terms of Service',
    acceptable_use_policy: 'StreamPulse Acceptable Use Policy',
    privacy_policy: 'StreamPulse Privacy Policy',
    support_whatsapp: defaultPaymentSettings.whatsapp_number,
    tier_limits: {
      free: { maxStreams: 1, maxHours: 10, maxChannels: 1, watermark: true },
      pro: { maxStreams: 2, maxHours: 720, maxChannels: 2, watermark: false },
      business: { maxStreams: 4, maxHours: -1, maxChannels: 4, watermark: false },
    },
    version: '2.4',
    last_updated: new Date().toISOString(),
  });
}

const apiServer = createServer(app);
let r2ClientPromise;
let r2CorsConfigurationPromise;

function getR2Configuration() {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET || 'stream-assets';

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Cloudflare R2 is not configured. Set CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, and CLOUDFLARE_R2_SECRET_ACCESS_KEY.');
  }

  return { accountId, accessKeyId, secretAccessKey, bucket };
}

async function getR2Client() {
  if (!r2ClientPromise) {
    r2ClientPromise = (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const { accountId, accessKeyId, secretAccessKey } = getR2Configuration();
      return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    })().catch((error) => {
      r2ClientPromise = null;
      throw error;
    });
  }
  return r2ClientPromise;
}

function getR2CorsOrigins() {
  return (process.env.R2_CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || 'https://streempuls.mooo.com')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== '*');
}

async function ensureR2BrowserCors() {
  if (!r2CorsConfigurationPromise) {
    r2CorsConfigurationPromise = (async () => {
      const { PutBucketCorsCommand } = await import('@aws-sdk/client-s3');
      const client = await getR2Client();
      const { bucket } = getR2Configuration();
      const corsOrigins = getR2CorsOrigins();

      if (corsOrigins.length === 0) {
        throw new Error('Set R2_CORS_ALLOWED_ORIGINS to the frontend origin, for example https://streempuls.mooo.com.');
      }

      await client.send(new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [{
            AllowedOrigins: corsOrigins,
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          }],
        },
      }));
      console.log(`[Cloudflare R2] Browser CORS configured for ${corsOrigins.join(', ')} on bucket ${bucket}`);
    })().catch((error) => {
      r2CorsConfigurationPromise = null;
      throw error;
    });
  }
  return r2CorsConfigurationPromise;
}

function readUsers() {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function readStreams() {
  const streams = readJsonFile(STREAMS_FILE, []);
  return Array.isArray(streams) ? streams : [];
}

function writeStreams(streams) {
  writeJsonFile(STREAMS_FILE, streams);
}

function normalizeStreamPayload(payload = {}) {
  return {
    title: payload.title,
    description: payload.description,
    video_url: payload.videoUrl ?? payload.video_url,
    thumbnail_url: payload.thumbnailUrl ?? payload.thumbnail_url ?? null,
    stream_key: payload.streamKey ?? payload.stream_key,
    rtmp_server_url: payload.rtmpServerUrl ?? payload.rtmp_server_url ?? 'rtmp://a.rtmp.youtube.com/live2',
    destinations: Array.isArray(payload.destinations) ? payload.destinations : [],
    orientation: payload.orientation === 'vertical' ? 'vertical' : 'horizontal',
    category: payload.category || 'Entertainment',
    audience: payload.audience === 'made_for_kids' ? 'made_for_kids' : 'not_for_kids',
    visibility: ['public', 'unlisted', 'private', 'scheduled'].includes(payload.visibility) ? payload.visibility : 'public',
    scheduled_for: payload.scheduledFor ?? payload.scheduled_for ?? null,
    direct_copy_mode: payload.directCopyMode ?? payload.direct_copy_mode ?? true,
    is_looping: payload.isLooping ?? payload.is_looping ?? true,
  };
}

function getStreamUser(userId) {
  const users = readUsers();
  return users.find((user) => user.id === userId)
    || users.find((user) => user.subscription_status === 'active')
    || users[0];
}

function getStreamLimits(user) {
  const tier = user?.subscription_tier || 'free';
  return {
    channelLimit: Math.max(1, Number(user?.channel_limit) || 1),
    destinationLimit: tier === 'business' ? 4 : tier === 'pro' ? 2 : 1,
  };
}

function getTierConfig(tier) {
  const tiers = {
    free: { channel_limit: 1, video_limit: 1, duration_days: 3, hour_limit: 10, has_watermark: true, is_brand_free: false, price_bdt: 0 },
    basic: { channel_limit: 1, video_limit: 1, duration_days: 30, hour_limit: null, has_watermark: false, is_brand_free: true, price_bdt: 1200 },
    pro: { channel_limit: 2, video_limit: 2, duration_days: 30, hour_limit: null, has_watermark: false, is_brand_free: true, price_bdt: 4000 },
    business: { channel_limit: 4, video_limit: 4, duration_days: 30, hour_limit: null, has_watermark: false, is_brand_free: true, price_bdt: 12000 },
  };
  return tiers[tier];
}

function safeUser(user) {
  const { password, password_hash, password_salt, auth_token_hash, ...profile } = user;
  return profile;
}

app.get(['/health', '/healthz', '/api/health'], (_req, res) => {
  return res.status(200).json({
    status: 'healthy',
    ready: true,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/users', (_req, res) => {
  return res.json({ success: true, users: readUsers().map(safeUser) });
});

app.get('/api/payment-settings', (_req, res, next) => {
  try {
    return res.status(200).json({ success: true, settings: readPaymentSettings() });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/site-content', (_req, res, next) => {
  try {
    const content = readSiteContent();
    const paymentSettings = readPaymentSettings();
    return res.status(200).json({
      success: true,
      content: {
        ...content,
        support_whatsapp: paymentSettings.whatsapp_number || content.support_whatsapp,
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/storage/presigned-upload', async (req, res, next) => {
  try {
    const {
      fileName,
      contentType = 'video/mp4',
      fileSizeMb,
      preferredProvider = 'r2',
      expiresIn = 900,
    } = req.body || {};

    if (preferredProvider !== 'r2') {
      return res.status(400).json({ success: false, error: 'This endpoint only generates Cloudflare R2 upload URLs.' });
    }
    if (typeof fileName !== 'string' || !fileName.trim()) {
      return res.status(400).json({ success: false, error: 'fileName is required.' });
    }
    if (typeof contentType !== 'string' || !/^(video|image)\/[a-z0-9.+-]+$/i.test(contentType)) {
      return res.status(400).json({ success: false, error: 'A valid video or image Content-Type is required.' });
    }
    if (fileSizeMb != null && (!Number.isFinite(Number(fileSizeMb)) || Number(fileSizeMb) <= 0 || Number(fileSizeMb) > 5000)) {
      return res.status(400).json({ success: false, error: 'fileSizeMb must be greater than 0 and no more than 5000 MB for a single PUT.' });
    }
    const requestOrigin = req.get('origin');
    const corsOrigins = getR2CorsOrigins();
    if (requestOrigin && !corsOrigins.includes(requestOrigin)) {
      return res.status(403).json({ success: false, error: 'This frontend origin is not allowed to upload directly to Cloudflare R2.' });
    }

    const { bucket, accountId } = getR2Configuration();
    const safeFileName = path.basename(fileName.trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `media/${Date.now()}-${randomUUID()}-${safeFileName}`;
    const ttl = Math.min(Math.max(Number(expiresIn) || 900, 60), 3600);

    // R2 checks bucket CORS on the browser's preflight; CORS headers on this API
    // response cannot grant PUT permission to the separate object-storage origin.
    await ensureR2BrowserCors();

    const client = await getR2Client();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttl },
    );

    const publicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN;
    const publicUrl = publicDomain
      ? `https://${publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${key}`
      : `https://${bucket}.${accountId}.r2.cloudflarestorage.com/${key}`;

    return res.status(200).json({
      success: true,
      uploadUrl,
      publicUrl,
      key,
      provider: 'r2',
      headers: { 'Content-Type': contentType },
      expiresInSeconds: ttl,
      method: 'PUT',
      cors: {
        allowedOrigin: requestOrigin || null,
        allowedMethods: ['PUT'],
        allowedHeaders: ['Content-Type'],
      },
      bypassBackendBandwidth: true,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/notifications', (req, res, next) => {
  try {
    const userId = req.get('x-user-id') || req.query.userId;
    const allNotifications = readJsonFile(NOTIFICATIONS_FILE, []);
    const notifications = (Array.isArray(allNotifications) ? allNotifications : [])
      .filter((notification) => !userId || notification.user_id === userId)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

    return res.status(200).json({
      success: true,
      notifications,
      unreadCount: notifications.filter((notification) => !notification.is_read).length,
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/notifications/:id/read', (req, res, next) => {
  try {
    const userId = req.get('x-user-id');
    const notifications = readJsonFile(NOTIFICATIONS_FILE, []);
    const notification = (Array.isArray(notifications) ? notifications : [])
      .find((item) => item.id === req.params.id && (!userId || item.user_id === userId));
    if (!notification) return res.status(404).json({ success: false, error: 'Notification not found' });

    notification.is_read = true;
    writeJsonFile(NOTIFICATIONS_FILE, notifications);
    return res.status(200).json({ success: true, notification });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/auth/me', (req, res) => {
  const users = readUsers();
  const bearerToken = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const requestedUserId = req.get('x-user-id');
  const tokenHash = bearerToken ? createHash('sha256').update(bearerToken).digest('hex') : null;
  const user = (tokenHash && users.find((candidate) => candidate.auth_token_hash === tokenHash))
    || users.find((candidate) => candidate.id === requestedUserId)
    || (!requestedUserId && !bearerToken ? users[0] : null);
  if (!user) return res.status(404).json({ success: false, error: 'No user session found' });
  return res.json({ success: true, user: safeUser(user) });
});

app.post('/api/auth/register', (req, res, next) => {
  try {
    const { email, password, full_name, fullName } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedName = typeof (full_name ?? fullName) === 'string' ? (full_name ?? fullName).trim() : '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long' });
    }

    const users = readUsers();
    if (users.some((user) => String(user.email).toLowerCase() === normalizedEmail)) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }

    const now = new Date().toISOString();
    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = scryptSync(password, passwordSalt, 64).toString('hex');
    const accessToken = randomBytes(32).toString('hex');
    const tierConfig = getTierConfig('free');
    const user = {
      id: randomUUID(),
      email: normalizedEmail,
      full_name: normalizedName || normalizedEmail.split('@')[0],
      role: 'user',
      subscription_tier: 'free',
      subscription_status: 'unpaid',
      ...tierConfig,
      password_hash: passwordHash,
      password_salt: passwordSalt,
      auth_token_hash: createHash('sha256').update(accessToken).digest('hex'),
      created_at: now,
      updated_at: now,
    };

    users.unshift(user);
    writeUsers(users);

    return res.status(201).json({
      success: true,
      user: safeUser(user),
      token: accessToken,
      accessToken,
      tokenType: 'Bearer',
      message: 'Account registered successfully.',
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/subscription/select-plan', (req, res, next) => {
  try {
    const { userId, planTier } = req.body || {};
    const tierConfig = getTierConfig(planTier);
    if (!userId || !tierConfig) {
      return res.status(400).json({ success: false, error: 'A valid userId and planTier are required' });
    }

    const users = readUsers();
    const userIndex = users.findIndex((user) => user.id === userId);
    if (userIndex === -1) return res.status(404).json({ success: false, error: 'User profile not found' });

    const durationDays = tierConfig.duration_days + (users[userIndex].trial_days_bonus || 0);
    const updatedUser = {
      ...users[userIndex],
      subscription_tier: planTier,
      subscription_status: 'active',
      expires_at: new Date(Date.now() + durationDays * 86400000).toISOString(),
      ...tierConfig,
      duration_days: durationDays,
      updated_at: new Date().toISOString(),
    };
    users[userIndex] = updatedUser;
    writeUsers(users);

    return res.status(200).json({
      success: true,
      user: safeUser(updatedUser),
      message: `${planTier.toUpperCase()} plan activated successfully.`,
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/subscription/checkout', (req, res, next) => {
  try {
    const { userId, planTier, paymentMethod } = req.body || {};
    const tierConfig = getTierConfig(planTier);
    if (!userId || !tierConfig) {
      return res.status(400).json({ success: false, error: 'A valid userId and planTier are required' });
    }

    const users = readUsers();
    const userIndex = users.findIndex((user) => user.id === userId);
    if (userIndex === -1) return res.status(404).json({ success: false, error: 'User profile not found' });

    const updatedUser = {
      ...users[userIndex],
      subscription_tier: planTier,
      subscription_status: 'active',
      expires_at: new Date(Date.now() + tierConfig.duration_days * 86400000).toISOString(),
      ...tierConfig,
      updated_at: new Date().toISOString(),
    };
    users[userIndex] = updatedUser;
    writeUsers(users);

    return res.status(200).json({
      success: true,
      user: safeUser(updatedUser),
      paymentMethod: paymentMethod || null,
      originalAmountBdt: tierConfig.price_bdt,
      discountBdt: 0,
      creditsUsedBdt: 0,
      finalAmountBdt: tierConfig.price_bdt,
      couponApplied: null,
      message: `${planTier.toUpperCase()} plan activated successfully.`,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/streams', (_req, res, next) => {
  try {
    const streams = readStreams().sort((left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
    return res.status(200).json({ success: true, streams });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/streams', (req, res, next) => {
  try {
    const payload = normalizeStreamPayload(req.body);
    if (typeof payload.title !== 'string' || !payload.title.trim()
      || typeof payload.video_url !== 'string' || !payload.video_url.trim()
      || typeof payload.stream_key !== 'string' || !payload.stream_key.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Title, videoUrl, and streamKey are required',
      });
    }

    const userId = req.get('x-user-id');
    const user = getStreamUser(userId);
    const { channelLimit, destinationLimit } = getStreamLimits(user);
    const streams = readStreams();
    const userStreams = streams.filter((stream) => !userId || stream.user_id === userId);
    if (userStreams.length >= channelLimit) {
      return res.status(403).json({
        success: false,
        error: `Your plan allows up to ${channelLimit} stream channel(s).`,
      });
    }
    if (payload.destinations.length > destinationLimit) {
      return res.status(403).json({
        success: false,
        error: `Your plan allows up to ${destinationLimit} streaming destination(s).`,
      });
    }

    const now = new Date().toISOString();
    const stream = {
      id: randomUUID(),
      ...payload,
      title: payload.title.trim().slice(0, 100),
      description: typeof payload.description === 'string' ? payload.description.slice(0, 500) : '',
      video_url: payload.video_url.trim(),
      stream_key: payload.stream_key.trim(),
      destinations: payload.destinations.slice(0, destinationLimit),
      user_id: userId || user?.id || null,
      status: 'idle',
      uptime_seconds: 0,
      current_bitrate_kbps: 0,
      fps: 0,
      cpu_usage_pct: 0,
      mem_usage_mb: 0,
      ffmpeg_pid: null,
      created_at: now,
      updated_at: now,
    };

    streams.unshift(stream);
    writeStreams(streams);
    return res.status(201).json({ success: true, stream });
  } catch (error) {
    return next(error);
  }
});

app.put('/api/streams/:id', (req, res, next) => {
  try {
    const streams = readStreams();
    const index = streams.findIndex((stream) => stream.id === req.params.id);
    if (index === -1) return res.status(404).json({ success: false, error: 'Stream not found' });

    const patch = normalizeStreamPayload({ ...streams[index], ...req.body });
    if (patch.destinations.length > getStreamLimits(getStreamUser(req.get('x-user-id'))).destinationLimit) {
      return res.status(403).json({ success: false, error: 'Your plan destination limit was exceeded.' });
    }

    const updated = {
      ...streams[index],
      ...patch,
      title: String(patch.title || '').trim().slice(0, 100),
      description: typeof patch.description === 'string' ? patch.description.slice(0, 500) : '',
      updated_at: new Date().toISOString(),
    };
    streams[index] = updated;
    writeStreams(streams);
    return res.status(200).json({ success: true, stream: updated });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/streams/:id', (req, res, next) => {
  try {
    const streams = readStreams();
    const index = streams.findIndex((stream) => stream.id === req.params.id);
    if (index === -1) return res.status(404).json({ success: false, error: 'Stream not found' });
    streams.splice(index, 1);
    writeStreams(streams);
    return res.status(200).json({ success: true, message: 'Stream deleted' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/streams/test-connection', (req, res) => {
  const { rtmpServerUrl = '', streamKey } = req.body || {};
  if (typeof streamKey !== 'string' || !streamKey.trim()) {
    return res.status(400).json({ success: false, error: 'A stream key is required' });
  }
  if (rtmpServerUrl && !/^rtmps?:\/\//i.test(rtmpServerUrl)) {
    return res.status(400).json({ success: false, error: 'RTMP URL must start with rtmp:// or rtmps://' });
  }
  return res.status(200).json({ success: true, message: 'Destination is ready for streaming.' });
});

app.post('/api/streams/:id/start', async (req, res, next) => {
  try {
    const streams = readStreams();
    const index = streams.findIndex((stream) => stream.id === req.params.id);
    if (index === -1) return res.status(404).json({ success: false, error: 'Stream not found' });

    const stream = streams[index];
    if (!stream.video_url || !stream.stream_key) {
      return res.status(400).json({ success: false, error: 'Stream video URL and stream key are required before starting.' });
    }

    const { streamQueue } = await import('./queue.js');
    const job = await streamQueue.add('start-stream', {
      streamId: stream.id,
      videoUrl: stream.video_url,
      streamKey: stream.stream_key,
      rtmpServerUrl: stream.rtmp_server_url,
      destinations: stream.destinations,
      subscriptionTier: getStreamUser(req.get('x-user-id') || stream.user_id)?.subscription_tier || 'free',
      orientation: stream.orientation,
      directCopyMode: stream.direct_copy_mode,
      isLooping: stream.is_looping,
    }, { jobId: `start-${stream.id}-${Date.now()}` });

    streams[index] = {
      ...stream,
      status: 'starting',
      updated_at: new Date().toISOString(),
      last_started_at: new Date().toISOString(),
    };
    writeStreams(streams);
    return res.status(202).json({ success: true, pid: null, jobId: job.id, status: 'starting' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/streams/:id/stop', async (req, res, next) => {
  try {
    const streams = readStreams();
    const index = streams.findIndex((stream) => stream.id === req.params.id);
    if (index === -1) return res.status(404).json({ success: false, error: 'Stream not found' });

    const { redisClient } = await import('./queue.js');
    await redisClient.publish('stream-control-bus', JSON.stringify({ action: 'STOP', streamId: req.params.id }));
    streams[index] = {
      ...streams[index],
      status: 'idle',
      ffmpeg_pid: null,
      current_bitrate_kbps: 0,
      fps: 0,
      cpu_usage_pct: 0,
      mem_usage_mb: 0,
      last_stopped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    writeStreams(streams);
    return res.status(200).json({ success: true, status: 'idle', message: 'Stream stop requested.' });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/streams/:id/logs', (req, res) => {
  const stream = readStreams().find((item) => item.id === req.params.id);
  if (!stream) return res.status(404).json({ success: false, error: 'Stream not found' });
  const isLive = stream.status === 'live' || stream.status === 'starting';
  return res.status(200).json({
    success: true,
    logs: [`[${stream.status}] Stream ${stream.title} is ${stream.status}.`],
    isLive,
    pid: stream.ffmpeg_pid ?? null,
  });
});

app.get('/api/streams/:id/telemetry', (req, res) => {
  const stream = readStreams().find((item) => item.id === req.params.id);
  if (!stream) return res.status(404).json({ success: false, error: 'Stream not found' });
  return res.status(200).json({
    success: true,
    status: stream.status,
    telemetry: {
      bitrate_kbps: stream.current_bitrate_kbps || 0,
      fps: stream.fps || 0,
      dropped_frames: 0,
      cpu_usage_pct: stream.cpu_usage_pct || 0,
      mem_usage_mb: stream.mem_usage_mb || 0,
      health_status: stream.status === 'live' ? 'good' : 'warning',
      speed: stream.status === 'live' ? '1.00x' : '0.00x',
      uptime_seconds: stream.uptime_seconds || 0,
      destinations_count: (stream.destinations?.length || 0) + 1,
      timestamp: new Date().toISOString(),
    },
  });
});

// Unknown API paths must remain JSON and must never reach the SPA fallback.
app.use('/api', (req, res) => {
  return res.status(404).json({
    success: false,
    error: `API endpoint ${req.method} ${req.originalUrl} not found`,
  });
});

// Convert malformed JSON and other API middleware/route errors to JSON responses.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    const status = Number(error.status || error.statusCode) || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal API error' });
  }
  return next(error);
});

// Serve built frontend assets; index.html is reserved for the explicit SPA route below.
app.use(express.static(DIST_DIR, { index: false, maxAge: '1d' }));

app.get('*', (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: `API endpoint ${req.method} ${req.originalUrl} not found` });
  }
  if (req.path === '/health' || req.path === '/healthz') {
    return res.status(200).json({ status: 'healthy', ready: true, timestamp: new Date().toISOString() });
  }
  return res.sendFile(path.join(DIST_DIR, 'index.html'), (error) => {
    if (error) next(error);
  });
});

app.use((error, _req, res, _next) => {
  console.error('[HTTP Error]', error);
  return res.status(Number(error.status || error.statusCode) || 500).json({
    success: false,
    error: 'Internal server error',
  });
});

const connectedClients = new Set();
const websocketOriginAllowed = (origin) => !origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin);
const websocketOptions = {
  path: '/ws/sync',
  verifyClient: ({ origin }, callback) => {
    callback(websocketOriginAllowed(origin), websocketOriginAllowed(origin) ? undefined : 403, 'Origin not allowed');
  },
};

function sendInitialConfig(ws) {
  ws.send(JSON.stringify({
    type: 'INITIAL_CONFIG',
    payload: {
      paymentSettings: readPaymentSettings(),
      siteContent: readSiteContent(),
      timestamp: new Date().toISOString(),
    },
  }));
}

function handleWebSocketConnection(ws) {
  connectedClients.add(ws);
  try {
    sendInitialConfig(ws);
  } catch (error) {
    console.warn('[WebSocket] Failed to send initial configuration:', error.message);
  }
  ws.on('close', () => connectedClients.delete(ws));
  ws.on('error', () => connectedClients.delete(ws));
}

// Serve the public wss://<domain>/ws/sync upgrade on the same origin/port as Express.
const wss = new WebSocketServer({ server: apiServer, ...websocketOptions });
wss.on('connection', handleWebSocketConnection);

// Keep port 4001 available for existing direct/internal WebSocket clients.
const legacyWebSocketHttpServer = createServer();
const legacyWss = new WebSocketServer({ server: legacyWebSocketHttpServer, ...websocketOptions });
legacyWss.on('connection', handleWebSocketConnection);
const legacyWebSocketPort = Number(process.env.WS_PORT) || 4001;
legacyWebSocketHttpServer.listen(legacyWebSocketPort, () => {
  console.log(`[WebSocket] Compatibility listener on port ${legacyWebSocketPort} at /ws/sync`);
});

apiServer.listen(PORT, () => {
  console.log(`[API] Express server listening on port ${PORT}`);
  console.log(`[WebSocket] Public sync endpoint available at /ws/sync on port ${PORT}`);
});
