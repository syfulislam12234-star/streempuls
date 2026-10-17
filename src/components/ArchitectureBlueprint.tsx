import React, { useState } from 'react';
import { Server, Copy, Check, Terminal, Cpu, HardDrive, ShieldAlert, FileCode2, ExternalLink, Zap, Layers, Play } from 'lucide-react';

export const ArchitectureBlueprint: React.FC = () => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeCodeTab, setActiveCodeTab] = useState<'compose' | 'dockerfile-worker' | 'dockerfile-api' | 'scaling-guide'>('compose');
  const [simulatedScaleCount, setSimulatedScaleCount] = useState<number>(3);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const fileSnippets = {
    compose: `version: '3.8'

# ============================================================================
# StreamPulse 24/7 YouTube Live Streaming SaaS - Multi-Container Stack
# Production Deployment for Hetzner VPS (Ubuntu 22.04 / 24.04 LTS)
# ============================================================================

services:
  # --------------------------------------------------------------------------
  # 1. REDIS CACHE & BULLMQ MESSAGE BROKER (Alpine)
  # --------------------------------------------------------------------------
  redis:
    image: redis:7.2-alpine
    container_name: streampulse-redis
    restart: unless-stopped
    command: >
      redis-server 
      --appendonly yes 
      --maxmemory 1024mb 
      --maxmemory-policy allkeys-lru
    ports:
      - "127.0.0.1:6379:6379" # Bound only to localhost for security
    volumes:
      - redis-data:/data
    networks:
      - streampulse-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # --------------------------------------------------------------------------
  # 2. EXPRESS API GATEWAY (HTTP REST API)
  # --------------------------------------------------------------------------
  backend-api:
    build:
      context: ./backend
      dockerfile: Dockerfile.api
    container_name: streampulse-api
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
      - QUEUE_NAME=streaming-queue
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - SUPABASE_URL=\${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=\${SUPABASE_SERVICE_ROLE_KEY}
      - SUPABASE_ANON_KEY=\${SUPABASE_ANON_KEY}
      - SUPABASE_STORAGE_BUCKET=\${SUPABASE_STORAGE_BUCKET:-stream-assets}
      - STORAGE_PROVIDER=\${STORAGE_PROVIDER:-supabase}
      - CLOUDFLARE_R2_ACCOUNT_ID=\${CLOUDFLARE_R2_ACCOUNT_ID:-}
      - CLOUDFLARE_R2_ACCESS_KEY_ID=\${CLOUDFLARE_R2_ACCESS_KEY_ID:-}
      - CLOUDFLARE_R2_SECRET_ACCESS_KEY=\${CLOUDFLARE_R2_SECRET_ACCESS_KEY:-}
      - CLOUDFLARE_R2_BUCKET=\${CLOUDFLARE_R2_BUCKET:-stream-assets}
      - CLOUDFLARE_R2_PUBLIC_DOMAIN=\${CLOUDFLARE_R2_PUBLIC_DOMAIN:-}
    ports:
      - "3000:3000"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - streampulse-net
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "5"

  # --------------------------------------------------------------------------
  # 3. ISOLATED STREAMING WORKER NODES (stream-worker-node)
  # Fault-Tolerant Horizontal Scaling:
  # docker compose up -d --scale stream-worker-node=N
  # Enforces MAX 10 active live streams per container (MAX_CONCURRENT_STREAMS=10).
  # If a worker container crashes under load, restart policies reboot it cleanly
  # without affecting the API gateway or sibling worker containers.
  # --------------------------------------------------------------------------
  stream-worker-node:
    build:
      context: ./backend
      dockerfile: Dockerfile.worker
    restart: always
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2048M
        reservations:
          cpus: '0.5'
          memory: 512M
      restart_policy:
        condition: any
        delay: 5s
        max_attempts: 10
        window: 120s
    environment:
      - NODE_ENV=production
      - QUEUE_NAME=streaming-queue
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MAX_CONCURRENT_STREAMS=10
      - WORKER_CONCURRENCY=10
      - MEMORY_CEILING_MB=1850
      - STORAGE_PROVIDER=\${STORAGE_PROVIDER:-supabase}
      - SUPABASE_URL=\${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=\${SUPABASE_SERVICE_ROLE_KEY}
      - SUPABASE_ANON_KEY=\${SUPABASE_ANON_KEY}
      - SUPABASE_STORAGE_BUCKET=\${SUPABASE_STORAGE_BUCKET:-stream-assets}
      - CLOUDFLARE_R2_ACCOUNT_ID=\${CLOUDFLARE_R2_ACCOUNT_ID:-}
      - CLOUDFLARE_R2_ACCESS_KEY_ID=\${CLOUDFLARE_R2_ACCESS_KEY_ID:-}
      - CLOUDFLARE_R2_SECRET_ACCESS_KEY=\${CLOUDFLARE_R2_SECRET_ACCESS_KEY:-}
      - CLOUDFLARE_R2_BUCKET=\${CLOUDFLARE_R2_BUCKET:-stream-assets}
      - CLOUDFLARE_R2_PUBLIC_DOMAIN=\${CLOUDFLARE_R2_PUBLIC_DOMAIN:-}
    depends_on:
      redis:
        condition: service_healthy
      backend-api:
        condition: service_started
    networks:
      - streampulse-net
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"

volumes:
  redis-data:
    driver: local

networks:
  streampulse-net:
    driver: bridge`,

    'dockerfile-worker': `# ============================================================================
# StreamPulse - Isolated FFmpeg 24/7 Streaming Worker Dockerfile
# Lean Node 20 Alpine container equipped with FFmpeg & Tini init system
# ============================================================================

FROM node:20-alpine AS base

# Install FFmpeg, ca-certificates, and tini (for proper signal forwarding to child processes)
RUN apk add --no-cache \\
    ffmpeg \\
    ca-certificates \\
    tini \\
    curl

WORKDIR /app

# Install dependencies (leverage Docker layer caching)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy worker application source files
COPY worker.js queue.js supabase.js ./

# Set environment
ENV NODE_ENV=production
ENV QUEUE_NAME=streaming-queue

# Non-root user for security (ensure user has permissions to execute ffmpeg)
USER node

# Use tini as init process to properly handle signals (SIGTERM/SIGINT) for child FFmpeg processes
ENTRYPOINT ["/sbin/tini", "--"]

# Start BullMQ isolated streaming worker
CMD ["node", "worker.js"]`,

    'dockerfile-api': `# ============================================================================
# StreamPulse - Express API Gateway Dockerfile
# Lean production container based on Node 20 Alpine
# ============================================================================

FROM node:20-alpine AS base

# Install curl for healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Install dependencies first (leverage Docker layer caching)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application source code
COPY server.js queue.js supabase.js ./

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Non-root user for security
USER node

# Expose HTTP port
EXPOSE 3000

# Health check to ensure Express API gateway is responsive
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Start API Gateway
CMD ["node", "server.js"]`,

    'scaling-guide': `# ============================================================================
# 1-Click Horizontal Worker Scaling: docker compose up -d --scale
# ============================================================================

# 1. Start baseline cluster (1 API, 1 Redis, 1 Worker with 16 slots):
docker compose up -d

# 2. Instantly scale to 3 isolated worker containers (3 x 16 = 48 streams):
docker compose up -d --scale streaming-worker=3

# 3. Instantly scale to 5 isolated worker containers (5 x 16 = 80 streams):
docker compose up -d --scale streaming-worker=5

# Why this scales with ZERO downtime and ZERO port conflicts:
# -------------------------------------------------------------
# 1. No Host Port Binding:
#    'streaming-worker' is an internal background daemon. It only connects outbound
#    to Redis ('redis:6379'), so Docker can spawn N instances without 'port already in use' errors.
#
# 2. BullMQ Competing Consumer Pattern:
#    All N worker containers bind to the same Redis queue ('streaming-queue').
#    When an Express API request calls streamQueue.add(), Redis automatically atomic-locks
#    and dispatches jobs to whichever worker container has available concurrency headroom.
#
# 3. True Fault Isolation:
#    If Container #2 experiences a kernel or OOM crash, Container #1 and #3 continue
#    broadcasting their 24/7 live streams completely unaffected!`,
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40 border border-slate-800 shadow-xl">
        <div className="flex items-center space-x-2 text-xs font-mono uppercase tracking-wider text-amber-400 mb-1">
          <Server className="w-4 h-4 text-amber-400" />
          <span>TASK 4 &middot; Production Docker & Hetzner VPS Deployment</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">
          Multi-Container Docker Architecture & Instant Horizontal Scaling
        </h2>
        <p className="text-sm text-slate-300 mt-1 max-w-3xl">
          Complete production setup featuring <span className="text-emerald-400 font-semibold">Redis Alpine</span>, 
          the Express <span className="text-blue-400 font-semibold">API Gateway</span>, and an isolated 
          <span className="text-rose-400 font-semibold"> FFmpeg worker pool</span> scalable on-demand via 
          <code className="text-amber-300 bg-slate-950/60 px-1 py-0.5 rounded text-xs ml-1">docker compose up -d --scale streaming-worker=N</code>.
        </p>
      </div>

      {/* Interactive Horizontal Scaling Simulator */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Interactive Horizontal Worker Scaling Demonstrator</span>
            </h3>
            <p className="text-xs text-slate-400">
              Demonstrates how scaling worker containers dynamically multiplies cluster capacity with 0 port conflicts.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            {[1, 2, 4, 6].map((count) => (
              <button
                key={count}
                onClick={() => setSimulatedScaleCount(count)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                  simulatedScaleCount === count
                    ? 'bg-amber-600 text-white font-bold'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                Scale N={count}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic CLI Box */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs space-y-2">
          <div className="flex items-center space-x-2 text-slate-400">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-200">
              $ docker compose up -d --scale streaming-worker={simulatedScaleCount}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 space-y-0.5 pt-1">
            <p className="text-emerald-400">&bull; Container streampulse-redis [Running]</p>
            <p className="text-emerald-400">&bull; Container streampulse-api [Running]</p>
            {Array.from({ length: simulatedScaleCount }).map((_, i) => (
              <p key={i} className="text-emerald-300">
                &bull; Container streampulse-streaming-worker-{i + 1} [Started &amp; Connected to streaming-queue]
              </p>
            ))}
          </div>
        </div>

        {/* Capacity Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 font-mono text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-500 block">Worker Containers</span>
            <span className="text-amber-400 font-bold text-sm">{simulatedScaleCount} instances</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-500 block">Total Concurrent Streams</span>
            <span className="text-emerald-400 font-bold text-sm">{simulatedScaleCount * 16} live streams</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-500 block">Host Port Conflicts</span>
            <span className="text-blue-400 font-bold text-sm">0 (Internal Queue Consumers)</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-500 block">Hetzner VPS CPU Load</span>
            <span className="text-purple-400 font-bold text-sm">~{(simulatedScaleCount * 16 * 0.38).toFixed(1)}% (-c copy)</span>
          </div>
        </div>
      </div>

      {/* Code Blueprints Tabs */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none pb-1 sm:pb-0">
            {[
              { id: 'compose', label: 'docker-compose.yml' },
              { id: 'dockerfile-worker', label: 'Dockerfile.worker (FFmpeg)' },
              { id: 'dockerfile-api', label: 'Dockerfile.api (Gateway)' },
              { id: 'scaling-guide', label: 'Scaling Guide (--scale N)' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCodeTab(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors whitespace-nowrap ${
                  activeCodeTab === tab.id
                    ? 'bg-amber-600 text-white font-semibold'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                <FileCode2 className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => handleCopy(fileSnippets[activeCodeTab], activeCodeTab)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 border border-slate-700 cursor-pointer self-start sm:self-auto"
          >
            {copiedKey === activeCodeTab ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedKey === activeCodeTab ? 'Copied File!' : 'Copy File Content'}</span>
          </button>
        </div>

        {/* Code Content Box */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-xs text-slate-300 overflow-x-auto max-h-[500px]">
          <pre>{fileSnippets[activeCodeTab]}</pre>
        </div>
      </div>
    </div>
  );
};
