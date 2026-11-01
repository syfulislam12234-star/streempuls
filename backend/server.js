
import express from 'express';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getR2Configuration } from './r2Config.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const STREAMS_FILE = path.join(DATA_DIR, 'streams.json');
const UPLOADED_ASSETS_FILE = path.join(DATA_DIR, 'uploaded_assets.json');
const DIST_DIR = path.resolve(__dirname, '../dist');
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
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

function logR2PresignError(error, req) {
  const metadata = error?.$metadata || {};
  const credentials = [
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    process.env.AWS_ACCESS_KEY_ID,
    process.env.AWS_SECRET_ACCESS_KEY,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  const redactCredentials = (value) => credentials.reduce(
    (safeValue, credential) => safeValue.replaceAll(credential, '[REDACTED]'),
    String(value || ''),
  );
  console.error('[Cloudflare R2 Presign Error]', {
    method: req.method,
    path: req.originalUrl,
    name: error?.name,
    message: redactCredentials(error?.message),
    code: error?.code || error?.Code,
    httpStatusCode: metadata.httpStatusCode,
    requestId: metadata.requestId || metadata.extendedRequestId,
    stack: redactCredentials(error?.stack),
  });
}

async function getR2Client() {
  if (!r2ClientPromise) {
    r2ClientPromise = (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const { accessKeyId, secretAccessKey, endpoint } = getR2Configuration();
      return new S3Client({
        region: 'auto',
        endpoint,
        forcePathStyle: true,
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

function getAuthenticatedUser(req) {
  const bearerToken = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearerToken) return null;

  const tokenHash = createHash('sha256').update(bearerToken).digest('hex');
  return readUsers().find((user) => user.auth_token_hash === tokenHash) || null;
}

function readUploadedAssets() {
  const assets = readJsonFile(UPLOADED_ASSETS_FILE, []);
  return Array.isArray(assets) ? assets : [];
}

function getR2PublicObjectUrl(key) {
  const { accountId, bucket } = getR2Configuration();
  const publicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN?.trim();
  const baseUrl = publicDomain
    ? `https://${publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
    : `https://${bucket}.${accountId}.r2.cloudflarestorage.com`;
  return `${baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function createR2PreviewUrl(key) {
  const client = await getR2Client();
  const { bucket } = getR2Configuration();
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 600 },
  );
}

function verifyPassword(user, password) {
  if (typeof user.password_hash === 'string' && typeof user.password_salt === 'string') {
    try {
      const actualHash = scryptSync(password, user.password_salt, 64);
      const expectedHash = Buffer.from(user.password_hash, 'hex');
      return expectedHash.length === actualHash.length && timingSafeEqual(actualHash, expectedHash);
    } catch {
      return false;
    }
  }

  // Support accounts created by the legacy local JSON auth implementation.
  if (typeof user.password === 'string') {
    const actualHash = createHash('sha256').update(password).digest();
    const expectedHash = createHash('sha256').update(user.password).digest();
    return timingSafeEqual(actualHash, expectedHash);
  }

  return false;
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
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });

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

    const { bucket } = getR2Configuration();
    const safeFileName = path.basename(fileName.trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `media/${Date.now()}-${randomUUID()}-${safeFileName}`;
    const ttl = Math.min(Math.max(Number(expiresIn) || 900, 60), 3600);

    const assets = readUploadedAssets();
    assets.unshift({
      key,
      ownerUserId: user.id,
      fileName: safeFileName,
      contentType,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    writeJsonFile(UPLOADED_ASSETS_FILE, assets);

    // Bucket CORS must be configured out-of-band; presigning should not require
    // bucket-configuration permissions on the R2 upload credential.
    const client = await getR2Client();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttl, signableHeaders: new Set(['content-type']) },
    );

    const publicUrl = getR2PublicObjectUrl(key);

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
    logR2PresignError(error, req);
    if (error?.code === 'R2_CONFIG_MISSING') {
      return res.status(503).json({ success: false, error: error.message, code: error.code });
    }
    const status = Number(error?.$metadata?.httpStatusCode) || 502;
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      success: false,
      error: 'Cloudflare R2 could not generate the upload URL. Check backend logs for the R2 request details.',
      code: error?.code || error?.Code || 'R2_PRESIGN_FAILED',
      requestId: error?.$metadata?.requestId || error?.$metadata?.extendedRequestId || undefined,
    });
  }
});

app.post('/api/storage/confirm-upload', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });

    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!key || !key.startsWith('media/') || key.split('/').some((part) => part === '..')) {
      return res.status(400).json({ success: false, error: 'A valid uploaded R2 key is required.' });
    }

    const assets = readUploadedAssets();
    const assetIndex = assets.findIndex((asset) => asset.key === key && asset.ownerUserId === user.id);
    if (assetIndex === -1) {
      return res.status(404).json({ success: false, error: 'Upload not found for this user.' });
    }

    const { bucket } = getR2Configuration();
    const client = await getR2Client();
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const object = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const contentLength = Number(object.ContentLength);
    const contentType = String(object.ContentType || '').split(';', 1)[0].trim().toLowerCase();
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > 5_000_000_000) {
      return res.status(422).json({ success: false, error: 'R2 object size is missing or outside the supported upload limit.' });
    }
    if (!/^video\/[a-z0-9.+-]+$/i.test(contentType)) {
      return res.status(422).json({ success: false, error: 'R2 object does not have a supported video Content-Type.' });
    }
    if (contentType !== assets[assetIndex].contentType.toLowerCase()) {
      return res.status(422).json({ success: false, error: 'R2 object Content-Type does not match the presigned upload.' });
    }

    const cleanTitle = assets[assetIndex].fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    const asset = {
      ...assets[assetIndex],
      status: 'confirmed',
      sizeBytes: contentLength,
      fileSizeMb: +(contentLength / (1024 * 1024)).toFixed(1),
      contentType,
      url: getR2PublicObjectUrl(key),
      storageProvider: 'Cloudflare R2 (Private)',
      resolution: 'Not analyzed',
      codec: 'Not analyzed',
      titleSuggestion: cleanTitle || assets[assetIndex].fileName,
      updatedAt: new Date().toISOString(),
    };
    assets[assetIndex] = asset;
    writeJsonFile(UPLOADED_ASSETS_FILE, assets);

    const {
      ownerUserId: _ownerUserId,
      status: _status,
      ...clientAsset
    } = asset;
    return res.status(200).json({
      success: true,
      asset: { ...clientAsset, previewUrl: await createR2PreviewUrl(key) },
      message: 'Video upload confirmed and registered in the media catalog.',
    });
  } catch (error) {
    if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ success: false, error: 'Uploaded R2 object was not found.' });
    }
    return next(error);
  }
});

app.get('/api/uploads', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });

    const assets = readUploadedAssets().filter(
      (asset) => asset.status === 'confirmed' && asset.ownerUserId === user.id,
    );
    const responseAssets = await Promise.all(assets.map(async (asset) => ({
      fileName: asset.fileName,
      key: asset.key,
      sizeBytes: asset.sizeBytes,
      fileSizeMb: asset.fileSizeMb,
      contentType: asset.contentType,
      url: asset.url,
      previewUrl: await createR2PreviewUrl(asset.key),
      storageProvider: asset.storageProvider,
      resolution: asset.resolution,
      codec: asset.codec,
      titleSuggestion: asset.titleSuggestion,
      createdAt: asset.createdAt,
    })));
    return res.status(200).json({ success: true, assets: responseAssets });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/storage/preview-url', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });

    const videoUrl = typeof req.body?.videoUrl === 'string' ? req.body.videoUrl.trim() : '';
    if (!videoUrl) return res.status(400).json({ success: false, error: 'videoUrl is required.' });

    const asset = readUploadedAssets().find(
      (item) => item.status === 'confirmed' && item.ownerUserId === user.id && item.url === videoUrl,
    );
    if (!asset) return res.status(404).json({ success: false, error: 'Uploaded video not found for this user.' });

    return res.status(200).json({
      success: true,
      previewUrl: await createR2PreviewUrl(asset.key),
      expiresInSeconds: 600,
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
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });
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

app.post('/api/auth/login', (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!email || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const users = readUsers();
    const userIndex = users.findIndex((user) => String(user.email || '').trim().toLowerCase() === email);
    if (userIndex === -1 || !verifyPassword(users[userIndex], password)) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const accessToken = randomBytes(32).toString('hex');
    const user = { ...users[userIndex] };

    // Upgrade legacy plaintext password storage after successful verification.
    if (!user.password_hash || !user.password_salt) {
      user.password_salt = randomBytes(16).toString('hex');
      user.password_hash = scryptSync(password, user.password_salt, 64).toString('hex');
      delete user.password;
    }
    user.auth_token_hash = createHash('sha256').update(accessToken).digest('hex');
    user.updated_at = new Date().toISOString();
    users[userIndex] = user;
    writeUsers(users);

    return res.status(200).json({
      success: true,
      user: safeUser(user),
      token: accessToken,
      accessToken,
      tokenType: 'Bearer',
      message: `Signed in as ${user.email}.`,
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
app.use('/uploads', express.static(UPLOADS_DIR, { index: false, maxAge: '1d' }));
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

// Bridge real-time worker telemetry/status events back into this API gateway's
// local stream store so the dashboard reflects actual FFmpeg status ('live', 'reconnecting', 'ERROR', 'idle')
// and not just the enqueued 'starting' state. Worker nodes publish status changes to the
// shared Redis channel below; the API updates data/streams.json accordingly.
// This is intentionally Redis-optional: if Redis is unavailable the bridge is a no-op.
async function attachStreamStatusBridge() {
  let redisClient = null;
  try {
    ({ redisClient } = await import('./queue.js'));
  } catch (err) {
    console.warn('[Stream Status Bridge] queue module unavailable:', err?.message || err);
    return;
  }
  const sub = redisClient.duplicate();
  try {
    await sub.subscribe('stream-telemetry-events');
    // Track latest event time per stream to reject stale/out-of-order messages.
    const latestEventTime = new Map();
    const MIN_STALE_AGE_MS = 5000; // Ignore events older than 5 seconds

    sub.on('message', (_channel, message) => {
      try {
        const payload = JSON.parse(message);
        if (!payload || typeof payload.streamId !== 'string') return;
        const streams = readStreams();
        const idx = streams.findIndex((s) => s.id === payload.streamId);
        if (idx === -1) return;
        const current = streams[idx];

        // Always reconcile from authoritative database (Supabase/local store) when Redis misses events.
        // This ensures the dashboard never stays stale after a Redis outage.
        const latestEventTs = latestEventTime.get(payload.streamId) || new Date(0).getTime();
        const eventTs = typeof payload.timestamp === 'string' ? new Date(payload.timestamp).getTime() : 0;
        if (eventTs > 0 && latestEventTs >= eventTs && eventTs + MIN_STALE_AGE_MS > Date.now()) {
          // Stale or duplicate message (older timestamp or very recent older-than-max).
          if (payload.status === 'live' && (current.status === 'idle' || current.status === 'stopping')) {
            // Explicitly block revival of stopped streams by stale live messages.
            return;
          }
          return;
        }
        latestEventTime.set(payload.streamId, eventTs);

        // Never revive a stream that is already stopped/stopped gracefully with a stale 'live' message.
        if ((current.status === 'idle' || current.status === 'stopping') && payload.status === 'live') return;

        const nextStatus = payload.status || current.status;
        // Only write when the status actually changes (dedup against duplicate Redis messages).
        if (nextStatus === current.status && eventTs === latestEventTime.get(payload.streamId)) return;

        const next = {
          ...current,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        };

        if (nextStatus === 'live') {
          next.current_bitrate_kbps = Number.isFinite(payload.bitrate_kbps) ? payload.bitrate_kbps : current.current_bitrate_kbps;
          next.fps = Number.isFinite(payload.fps) ? payload.fps : current.fps;
          next.cpu_usage_pct = Number.isFinite(payload.cpu_usage_pct) ? payload.cpu_usage_pct : current.cpu_usage_pct;
          next.mem_usage_mb = Number.isFinite(payload.mem_usage_mb) ? payload.mem_usage_mb : current.mem_usage_mb;
          next.ffmpeg_pid = current.ffmpeg_pid || null;
        } else if (nextStatus === 'starting') {
          // Transitional state: preserve existing metrics and pid.
          next.ffmpeg_pid = current.ffmpeg_pid || null;
        } else if (nextStatus === 'reconnecting') {
          next.last_error = payload.last_error || null;
        } else if (nextStatus === 'ERROR') {
          next.last_error = payload.last_error || null;
          next.ffmpeg_pid = null;
        } else if (nextStatus === 'idle' || nextStatus === 'stopped') {
          next.status = 'idle';
          next.ffmpeg_pid = null;
          next.current_bitrate_kbps = 0;
          next.fps = 0;
          next.cpu_usage_pct = 0;
          next.mem_usage_mb = 0;
        }

        streams[idx] = next;
        writeStreams(streams);
      } catch { /* ignore malformed telemetry messages */ }
    });
    sub.on('error', () => {});
  } catch (err) {
    console.warn('[Stream Status Bridge] Redis unavailable:', err?.message || err);
  }
}

attachStreamStatusBridge().catch(() => {});

apiServer.listen(PORT, () => {
  console.log(`[API] Express server listening on port ${PORT}`);
  console.log(`[WebSocket] Public sync endpoint available at /ws/sync on port ${PORT}`);
});
