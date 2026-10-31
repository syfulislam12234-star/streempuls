
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
