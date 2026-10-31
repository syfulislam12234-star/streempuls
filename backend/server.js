
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(express.json());

app.get('/health', (_req, res) => {
  return res.status(200).json({
    status: 'healthy',
    ready: true,
    timestamp: new Date().toISOString(),
  });
});

function readLocalPayments() {
  ensureDataDir();
  try {
    if (fs.existsSync(PAYMENTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf-8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.error('[readLocalPayments] Error reading payments file:', e.message);
    return [];
  }
  return [];
}

// WebSocket Support (at end of file, outside any function)
let wss;
let connectedClients = new Set();

try {
  const server = createServer();
  wss = new WebSocketServer({ server, path: '/ws/sync' });
  connectedClients = new Set();
  wss.on('connection', (ws) => { connectedClients.add(ws); ws.on('close', () => connectedClients.delete(ws)); });
  server.listen(4001, () => console.log('[WebSocket] WebSocket Sync Server listening on port 4001 at /ws/sync'));
} catch (e) { console.error('[WebSocket] Failed to initialize WebSocket server:', e.message); }

app.listen(PORT, () => {
  console.log(`[API] Express server listening on port ${PORT}`);
});
