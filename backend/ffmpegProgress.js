import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';

function parseClock(value) {
  const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value || '');
  if (!match) return null;
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + fraction;
}

function parseNumber(value) {
  if (typeof value !== 'string' || value === 'N/A' || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFfmpegProgressRecord(record) {
  const fields = {};
  for (const line of String(record || '').split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  const bitrateMatch = /([0-9.]+)\s*kbits\/s/i.exec(fields.bitrate || '');
  const speedMatch = /^([0-9.]+)x$/i.exec(fields.speed || '');
  const fps = parseNumber(fields.fps);
  const bitrateKbps = bitrateMatch ? Number(bitrateMatch[1]) : null;
  return {
    frame: parseNumber(fields.frame),
    fps: fps !== null && fps >= 0 ? fps : null,
    bitrateKbps: bitrateKbps !== null && Number.isFinite(bitrateKbps) ? bitrateKbps : null,
    droppedFrames: parseNumber(fields.drop_frames) ?? parseNumber(fields.drop),
    outputTimeSeconds: parseClock(fields.out_time),
    speed: speedMatch ? Number(speedMatch[1]) : null,
    progress: fields.progress || null,
  };
}

export function probeFfmpegVideoMetadata(source, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    let timeout;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };

    let child;
    try {
      child = spawn('ffprobe', [
        '-v', 'error',
        '-read_intervals', '%+10',
        '-show_packets',
        '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate,pix_fmt,sample_rate,channels:format=duration:packet=pts_time,flags',
        '-of', 'json',
        source,
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(new Error('Video metadata probe could not start.'));
      return;
    }
    timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Video metadata probe timed out.'));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 5 * 1024 * 1024) {
        child.kill('SIGKILL');
        finish(new Error('Video metadata output exceeded its safety limit.'));
      }
    });
    child.on('error', () => finish(new Error('Video metadata probe failed.')));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error('Video metadata probe failed.'));
        return;
      }
      try {
        const result = JSON.parse(output);
        const video = result.streams?.find((stream) => stream.codec_type === 'video');
        const audio = result.streams?.find((stream) => stream.codec_type === 'audio');
        const width = Number(video?.width);
        const height = Number(video?.height);
        const duration = Number(result.format?.duration);
        if (!video?.codec_name || !Number.isInteger(width) || !Number.isInteger(height)
          || width <= 0 || height <= 0 || !Number.isFinite(duration) || duration <= 0) {
          finish(new Error('Video metadata is incomplete or invalid.'));
          return;
        }
        const keyframes = (result.packets || [])
          .filter((packet) => String(packet.flags || '').includes('K'))
          .map((packet) => Number(packet.pts_time))
          .filter(Number.isFinite)
          .sort((left, right) => left - right);
        const keyframeIntervalSeconds = keyframes.length >= 2
          ? Math.max(...keyframes.slice(1).map((time, index) => time - keyframes[index]))
          : null;
        finish(null, {
          codecName: video.codec_name,
          width,
          height,
          rFrameRate: video.r_frame_rate || null,
          bitrate: Number.isFinite(Number(video.bit_rate)) ? Number(video.bit_rate) : null,
          durationSeconds: duration,
          keyframeIntervalSeconds,
          pixFmt: video.pix_fmt || null,
          audioCodec: audio?.codec_name || null,
          audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
          audioChannels: audio?.channels ? Number(audio.channels) : null,
        });
      } catch {
        finish(new Error('Video metadata output is invalid.'));
      }
    });
  });
}

export function directCopyIneligibility(metadata) {
  if (!metadata || metadata.codecName !== 'h264') return 'codec-not-h264';
  const [numerator, denominator] = String(metadata.rFrameRate || '').split('/').map(Number);
  const fps = denominator ? numerator / denominator : Number(metadata.rFrameRate);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 60) return 'fps-over-60-or-unknown';
  if (!Number.isFinite(metadata.bitrate) || metadata.bitrate <= 0 || metadata.bitrate > 8_000_000) {
    return 'bitrate-over-8000000-or-unknown';
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)
    || metadata.width <= 0 || metadata.height <= 0
    || Math.max(metadata.width, metadata.height) > 1920
    || metadata.width % 2 !== 0 || metadata.height % 2 !== 0) {
    return 'resolution-unsupported';
  }
  if (!Number.isFinite(metadata.keyframeIntervalSeconds)
    || metadata.keyframeIntervalSeconds <= 0 || metadata.keyframeIntervalSeconds > 2.5) {
    return 'keyframe-interval-over-2.5s-or-unknown';
  }
  return null;
}

/**
 * Strict live-stream direct-copy profile. A video may only go live with
 * stream-copy (-c copy) when it has already been normalized at upload time to
 * this exact profile. Nothing is transcoded live.
 */
export function validateLiveCopyProfile(metadata) {
  if (!metadata) return 'metadata-unavailable';
  if (metadata.codecName !== 'h264') return 'codec-not-h264';
  if (metadata.width !== 1080 || metadata.height !== 1920) return 'resolution-not-1080x1920';
  const [numerator, denominator] = String(metadata.rFrameRate || '').split('/').map(Number);
  const fps = denominator ? numerator / denominator : Number(metadata.rFrameRate);
  if (!Number.isFinite(fps) || fps !== 30) return 'fps-not-30';
  if (metadata.pixFmt !== 'yuv420p') return 'pix-fmt-not-yuv420p';
  if (!Number.isFinite(metadata.keyframeIntervalSeconds)
    || metadata.keyframeIntervalSeconds < 1.5 || metadata.keyframeIntervalSeconds > 2.5) {
    return 'keyframe-interval-not-2-seconds';
  }
  if (metadata.audioCodec !== 'aac') return 'audio-codec-not-aac';
  if (metadata.audioSampleRate !== 44100) return 'audio-sample-rate-not-44100-hz';
  if (metadata.audioChannels !== 2) return 'audio-not-stereo';
  return null;
}

function parseProcessTicks(statLine) {
  const closeParen = statLine.lastIndexOf(')');
  if (closeParen < 0) return null;
  const fields = statLine.slice(closeParen + 2).trim().split(/\s+/);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks)) return null;
  return userTicks + systemTicks;
}

function parseTotalCpuTicks(statText) {
  const line = statText.split(/\r?\n/, 1)[0];
  if (!line.startsWith('cpu ')) return null;
  const ticks = line.slice(4).trim().split(/\s+/).slice(0, 8).map(Number);
  if (ticks.length < 4 || ticks.some((tick) => !Number.isFinite(tick))) return null;
  return ticks.reduce((sum, tick) => sum + tick, 0);
}

/**
 * Sample FFmpeg process CPU usage as a percentage of one logical CPU core.
 * Returns null on non-Linux systems or before a previous sample exists.
 */
export async function sampleProcessCpuPercent(pid, previousSample) {
  if (!Number.isInteger(pid) || pid <= 0) return { cpuPercent: null, sample: null };
  try {
    const [processStat, cpuStat] = await Promise.all([
      fs.readFile(`/proc/${pid}/stat`, 'utf8'),
      fs.readFile('/proc/stat', 'utf8'),
    ]);
    const processTicks = parseProcessTicks(processStat);
    const totalTicks = parseTotalCpuTicks(cpuStat);
    if (processTicks === null || totalTicks === null) return { cpuPercent: null, sample: null };
    const sample = { processTicks, totalTicks };
    if (!previousSample) return { cpuPercent: null, sample };

    const processDelta = processTicks - previousSample.processTicks;
    const totalDelta = totalTicks - previousSample.totalTicks;
    if (processDelta < 0 || totalDelta <= 0) return { cpuPercent: null, sample };
    const coreCount = Math.max(1, os.availableParallelism?.() || os.cpus().length || 1);
    return {
      cpuPercent: Math.min(coreCount * 100, (processDelta / totalDelta) * coreCount * 100),
      sample,
    };
  } catch {
    return { cpuPercent: null, sample: null };
  }
}

export async function readProcessMemoryMb(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const status = await fs.readFile(`/proc/${pid}/status`, 'utf8');
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    return match ? +(Number(match[1]) / 1024).toFixed(1) : null;
  } catch {
    return null;
  }
}
