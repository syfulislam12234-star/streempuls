
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
  const http = require('http');
  const WebSocket = require('ws');
  const { WebSocketServer } = WebSocket;

  const server = http.createServer();
  const wsServer = new WebSocketServer({ server, path: '/ws/sync' });
  connectedClients = new Set();
  wsServer.on('connection', (ws) => { connectedClients.add(ws); ws.on('close', () => connectedClients.delete(ws)); });
  server.listen(4001, () => console.log('[WebSocket] WebSocket Sync Server listening on port 4001 at /ws/sync'));
} catch (e) { console.error('[WebSocket] Failed to initialize WebSocket server:', e.message); }

// WebSocket Support (at end of file, outside any function)
try {
  const http = require('http');
  const WebSocket = require('ws');
  const { WebSocketServer } = WebSocket;

  const server = http.createServer();
  const wsServer = new WebSocketServer({ server, path: '/ws/sync' });
  connectedClients = new Set();
  wsServer.on('connection', (ws) => { connectedClients.add(ws); ws.on('close', () => connectedClients.delete(ws)); });
  server.listen(4001, () => console.log('[WebSocket] WebSocket Sync Server listening on port 4001 at /ws/sync'));
} catch (e) { console.error('[WebSocket] Failed to initialize WebSocket server:', e.message); }
