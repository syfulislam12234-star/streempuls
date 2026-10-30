export const BLUEPRINT_DATA = {
  dockerCompose: `version: '3.8'

services:
  # --------------------------------------------------------------------------
  # 1. API GATEWAY & WEB APP (Express + Vite)
  # --------------------------------------------------------------------------
  api-gateway:
    build:
      context: .
      dockerfile: Dockerfile.api
    container_name: streampulse-api
    restart: always
    environment:
      - PORT=3000
      - NODE_ENV=production
      - SUPABASE_URL=\${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=\${SUPABASE_SERVICE_ROLE_KEY}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - SUPABASE_ANON_KEY=\${SUPABASE_ANON_KEY}
      - SUPABASE_STORAGE_BUCKET=\${SUPABASE_STORAGE_BUCKET:-stream-assets}
    ports:
      - "3000:3000"
    depends_on:
      - redis
    networks:
      - streaming-net
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "5"

  # --------------------------------------------------------------------------
  # 2. ISOLATED FFMPEG STREAMING WORKER (Crash-Proof 24/7 Engine)
  # --------------------------------------------------------------------------
  stream-worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    container_name: streampulse-worker-node-1
    restart: always
    # Resource limits tailored for Hetzner VPS (e.g. CPX41 or CCX33)
    deploy:
      resources:
        limits:
          cpus: '6.0'
          memory: 8192M
        reservations:
          cpus: '1.0'
          memory: 2048M
    environment:
      - WORKER_NODE_ID=hetzner-node-01
      - SUPABASE_URL=\${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=\${SUPABASE_SERVICE_ROLE_KEY}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - DIRECT_COPY_ENFORCED=true
      - FFMPEG_LOG_LEVEL=warning
    depends_on:
      - redis
    networks:
      - streaming-net
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"

  # --------------------------------------------------------------------------
  # 3. REDIS HIGH-SPEED QUEUE & CACHE
  # --------------------------------------------------------------------------
  redis:
    image: redis:7.2-alpine
    container_name: streampulse-redis
    restart: always
    command: >
      redis-server 
      --save 60 1 
      --loglevel notice 
      --maxmemory 1024mb 
      --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    networks:
      - streaming-net

volumes:
  redis-data:

networks:
  streaming-net:
    driver: bridge`,

  ffmpegPipelineCode: `/**
 * 24/7 Crash-Proof YouTube Streaming Worker (Node.js + FFmpeg -c copy)
 * Zero-Lag, Zero Transcoding CPU overhead (~0.5% CPU per 1080p stream)
 */
import { spawn, ChildProcess } from 'child_process';
import { createClient } from '@supabase/supabase-js';

export class IsolatedStreamProcess {
  private childProcess: ChildProcess | null = null;
  private isIntentionalStop = false;
  private restartAttempts = 0;
  private readonly maxRestarts = 15;

  constructor(
    private streamId: string,
    private videoUrl: string,
    private streamKey: string,
    private rtmpUrl: string = 'rtmp://a.rtmp.youtube.com/live2',
    private supabase: any
  ) {}

  public async start(): Promise<void> {
    this.isIntentionalStop = false;

    // FFmpeg Direct Copy Command:
    // -re: Read input at native framerate (crucial for continuous real-time broadcast)
    // -stream_loop -1: Seamless infinite 24/7 video loop
    // -i <videoUrl>: Source video (MP4/H.264 + AAC) stored in Supabase Storage ('stream-assets')
    // -c copy: ZERO-TRANSCODING (copies H.264 & AAC packets directly into FLV muxer)
    // -flvflags no_duration_filesize: Real-time live FLV streaming flags
    // -f flv: YouTube ingestion format
    const ffmpegArgs = [
      '-re',
      '-stream_loop', '-1',
      '-i', this.videoUrl,
      '-c', 'copy',
      '-flvflags', 'no_duration_filesize',
      '-f', 'flv',
      \`\${this.rtmpUrl}/\${this.streamKey}\`
    ];

    console.log(\`[Stream \${this.streamId}] Spawning isolated FFmpeg worker...\`);
    this.childProcess = spawn('ffmpeg', ffmpegArgs);

    // Track OS PID in Supabase for telemetry & external kill switch
    await this.supabase
      .from('streams')
      .update({
        status: 'live',
        ffmpeg_pid: this.childProcess.pid,
        last_heartbeat: new Date().toISOString(),
        last_started_at: new Date().toISOString(),
        restart_count: this.restartAttempts,
        last_error: null
      })
      .eq('id', this.streamId);

    // Watchdog stdout & stderr
    this.childProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.parseFfmpegTelemetry(line);
    });

    this.childProcess.on('exit', async (code, signal) => {
      console.warn(\`[Stream \${this.streamId}] Process exited with code \${code}, signal \${signal}\`);
      if (!this.isIntentionalStop) {
        await this.handleUnexpectedCrash(code);
      }
    });
  }

  private async parseFfmpegTelemetry(rawChunk: string): Promise<void> {
    // Extracts fps, q, bitrate, speed from FFmpeg stderr stream
    const bitrateMatch = rawChunk.match(/bitrate=\\s*([0-9.]+kbits\\/s)/);
    const fpsMatch = rawChunk.match(/fps=\\s*([0-9.]+)/);

    if (bitrateMatch || fpsMatch) {
      await this.supabase
        .from('streams')
        .update({
          last_heartbeat: new Date().toISOString(),
          current_bitrate_kbps: bitrateMatch ? parseInt(bitrateMatch[1], 10) : 4500,
          fps: fpsMatch ? parseFloat(fpsMatch[1]) : 60.0
        })
        .eq('id', this.streamId);
    }
  }

  private async handleUnexpectedCrash(code: number | null): Promise<void> {
    if (this.restartAttempts < this.maxRestarts) {
      this.restartAttempts++;
      const backoffDelay = Math.min(1000 * Math.pow(2, this.restartAttempts), 15000);
      console.log(\`[Recovery Watchdog] Restarting stream \${this.streamId} in \${backoffDelay}ms (Attempt \${this.restartAttempts})\`);

      await this.supabase
        .from('streams')
        .update({
          status: 'reconnecting',
          last_error: \`Unexpected exit code \${code}. Auto-recovering in \${backoffDelay}ms\`
        })
        .eq('id', this.streamId);

      setTimeout(() => this.start(), backoffDelay);
    } else {
      await this.supabase
        .from('streams')
        .update({
          status: 'failed',
          last_error: \`Exceeded maximum recovery attempts (\${this.maxRestarts})\`
        })
        .eq('id', this.streamId);
    }
  }

  public async stop(): Promise<void> {
    this.isIntentionalStop = true;
    if (this.childProcess) {
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }
    await this.supabase
      .from('streams')
      .update({
        status: 'idle',
        ffmpeg_pid: null,
        last_stopped_at: new Date().toISOString()
      })
      .eq('id', this.streamId);
  }
}`,

  bullMqDynamicScalingCode: `/**
 * BullMQ Dynamic Concurrency & Redis Cache Listener
 * 1-Click Scaling: Updates worker capacity live from Supabase without restarting containers!
 */
import { Worker, Queue } from 'bullmq';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redisConnection = { host: process.env.REDIS_HOST || '127.0.0.1', port: 6379 };

export const streamQueue = new Queue('live-stream-dispatch', { connection: redisConnection });

// Initialize BullMQ Worker with baseline concurrency
let currentConcurrency = 16;
export const streamWorker = new Worker(
  'live-stream-dispatch',
  async (job) => {
    const { streamId, videoUrl, streamKey, rtmpUrl } = job.data;
    // Spawns isolated process...
  },
  {
    connection: redisConnection,
    concurrency: currentConcurrency,
    limiter: {
      max: 25,
      duration: 1000
    }
  }
);

/**
 * Real-time Supabase Listener for 1-Click Dynamic Scaling:
 * When an Admin clicks "Scale Concurrency" in the Dashboard:
 * 1. Supabase triggers an UPDATE on system_settings
 * 2. This subscriber catches the event instantly
 * 3. BullMQ dynamically adjusts worker concurrency on the fly!
 */
supabase
  .channel('system_settings_changes')
  .on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'system_settings' },
    (payload) => {
      const newSettings = payload.new;
      if (newSettings.worker_concurrency !== currentConcurrency) {
        console.log(
          \`[1-Click Scaler] Updating BullMQ concurrency from \${currentConcurrency} to \${newSettings.worker_concurrency}\`
        );
        currentConcurrency = newSettings.worker_concurrency;
        // Dynamically adjust BullMQ active concurrency slot
        streamWorker.concurrency = currentConcurrency;
      }
    }
  )
  .subscribe();`
};
