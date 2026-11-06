import React, { useState, useEffect } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  Radio,
  Wifi,
  AlertTriangle,
  CheckCircle2,
  X,
  Clock,
  Layers,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { apiClient, StreamRecord, StreamTelemetryData } from '../services/apiClient';

interface StreamTelemetryModalProps {
  stream: StreamRecord;
  onClose: () => void;
}

export const StreamTelemetryModal: React.FC<StreamTelemetryModalProps> = ({ stream, onClose }) => {
  const [telemetry, setTelemetry] = useState<StreamTelemetryData>({
    bitrate_kbps: 0,
    fps: 0,
    dropped_frames: null,
    cpu_usage_pct: null,
    mem_usage_mb: null,
    health_status: 'unknown',
    speed: null,
    uptime_seconds: stream.uptime_seconds || 0,
    destinations_count: (stream.destinations?.length || 0) + 1,
    timestamp: new Date().toISOString(),
  });
  const [telemetryHistory, setTelemetryHistory] = useState<number[]>([]);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(stream.status === 'live');

  useEffect(() => {
    // 1. Initial snapshot fetch
    apiClient.getStreamTelemetry(stream.id).then((data) => {
      if (data) {
        setTelemetry(data);
        setTelemetryHistory((prev) => [...prev.slice(-15), data.bitrate_kbps]);
      }
    }).catch(() => {});

    // 2. Real-time telemetry feed via SSE / Redis PubSub stream
    const unsubscribe = apiClient.listenToStreamTelemetry(stream.id, (data) => {
      setTelemetry(data);
      setIsLiveConnected(true);
      setTelemetryHistory((prev) => [...prev.slice(-15), data.bitrate_kbps]);
    });

    // 3. Fallback poll every 2.5s
    const pollId = setInterval(async () => {
      try {
        const snap = await apiClient.getStreamTelemetry(stream.id);
        if (snap) {
          setTelemetry(snap);
          setTelemetryHistory((prev) => [...prev.slice(-15), snap.bitrate_kbps]);
        }
      } catch (e) {}
    }, 2500);

    return () => {
      unsubscribe();
      clearInterval(pollId);
    };
  }, [stream.id]);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-red-600/10 border border-red-500/20 text-red-500 flex items-center justify-center">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-extrabold text-white tracking-tight">
                  Real-Time Stream Health Telemetry
                </h3>
                <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-0.5" />
                  Live Feed
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate max-w-md mt-0.5">
                {stream.title}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Highlights Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Bitrate */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Bitrate</span>
              <Wifi className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-xl font-extrabold text-white">
              {telemetry.bitrate_kbps > 0 ? `${telemetry.bitrate_kbps.toLocaleString()} kbps` : 'Standby'}
            </div>
            <div className="text-[10px] text-slate-400 font-medium">Measured FFmpeg output</div>
          </div>

          {/* FPS */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>FPS</span>
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-extrabold text-white">
              {telemetry.fps > 0 ? `${telemetry.fps.toFixed(1)} fps` : 'Measuring…'}
            </div>
            <div className="text-[10px] text-slate-400">Measured progress output</div>
          </div>

          {/* Dropped Frames */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Dropped Frames</span>
              <AlertTriangle className={`w-3.5 h-3.5 ${(telemetry.dropped_frames || 0) > 0 ? 'text-amber-400' : 'text-slate-500'}`} />
            </div>
            <div className={`text-xl font-extrabold ${(telemetry.dropped_frames || 0) > 0 ? 'text-amber-400' : 'text-white'}`}>
              {telemetry.dropped_frames ?? '—'}
            </div>
            <div className="text-[10px] text-slate-400 font-medium">
              {telemetry.dropped_frames === null ? 'Waiting for FFmpeg' : telemetry.dropped_frames === 0 ? 'None reported' : 'Frames dropped'}
            </div>
          </div>

          {/* Health Status */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Health Status</span>
              <CheckCircle2 className={`w-3.5 h-3.5 ${telemetry.health_status === 'good' || telemetry.health_status === 'excellent' ? 'text-emerald-400' : 'text-amber-400'}`} />
            </div>
            <div className={`text-lg font-extrabold capitalize ${telemetry.health_status === 'good' || telemetry.health_status === 'excellent' ? 'text-emerald-400' : 'text-amber-400'}`}>
              {telemetry.health_status}
            </div>
            <div className="text-[10px] text-slate-400">Uptime: {formatUptime(telemetry.uptime_seconds)}</div>
          </div>
        </div>

        {/* Worker Node Telemetry & Direct Copy CPU/RAM Watchdog */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center space-x-1.5">
                <Cpu className="w-4 h-4 text-purple-400" />
                <span>FFmpeg Process CPU</span>
              </span>
              <span className="text-purple-400 font-mono font-bold">
                {telemetry.cpu_usage_pct === null ? 'N/A' : `${telemetry.cpu_usage_pct.toFixed(2)}%`}
              </span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-purple-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (telemetry.cpu_usage_pct || 0) * 15)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Mode: {telemetry.video_mode || 'not reported'}{telemetry.transcode_reason ? ` (${telemetry.transcode_reason})` : ''}. CPU is sampled from the FFmpeg process when available.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center space-x-1.5">
                <HardDrive className="w-4 h-4 text-cyan-400" />
                <span>FFmpeg Process RAM</span>
              </span>
              <span className="text-cyan-400 font-mono font-bold">
                {telemetry.mem_usage_mb === null ? 'N/A' : `${telemetry.mem_usage_mb.toFixed(1)} MB`}
              </span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-cyan-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, ((telemetry.mem_usage_mb || 0) / 500) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Bounded isolated process footprint inside Docker worker container.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
            <span className="block text-slate-400">FFmpeg speed</span>
            <span className="font-mono font-bold text-white">{telemetry.speed || 'Waiting for progress'}</span>
          </div>
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
            <span className="block text-slate-400">Output delay vs wall clock</span>
            <span className="font-mono font-bold text-white">
              {telemetry.playback_delay_seconds == null ? 'N/A' : `${telemetry.playback_delay_seconds.toFixed(2)} s`}
            </span>
          </div>
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
            <span className="block text-slate-400">Local video cache</span>
            <span className="font-mono font-bold text-white capitalize">
              {telemetry.cache_status || 'not applicable'}
              {telemetry.cache_status === 'downloading' && telemetry.cache_progress_pct != null
                ? ` · ${telemetry.cache_progress_pct.toFixed(0)}%`
                : ''}
            </span>
            {telemetry.cache_fallback_reason ? (
              <span className="block text-slate-400">Fallback: {telemetry.cache_fallback_reason}</span>
            ) : null}
            {telemetry.input_download_mbps != null && telemetry.cache_status === 'downloading' ? (
              <span className="block text-slate-400">{telemetry.input_download_mbps.toFixed(2)} Mbps</span>
            ) : null}
            {telemetry.cached_video_codec ? (
              <span className="block text-slate-400">
                {telemetry.cached_video_codec} · {telemetry.cached_video_width}×{telemetry.cached_video_height}
              </span>
            ) : null}
            {telemetry.cache_disk_available_bytes != null ? (
              <span className="block text-slate-400">
                Disk free: {(telemetry.cache_disk_available_bytes / (1024 ** 3)).toFixed(1)} GiB
              </span>
            ) : null}
          </div>
        </div>

        {/* Multi-Casting Destinations Status */}
        <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-bold text-white">
              <Layers className="w-4 h-4 text-red-500" />
              <span>Active Broadcast Destinations ({telemetry.destinations_count || 1})</span>
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              Multi-platform concurrent stream outputs
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-slate-200 font-semibold">Primary Output</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-950/80 text-red-300 border border-red-800/40 font-mono">
                FLV Muxer OK
              </span>
            </div>

            {stream.destinations && stream.destinations.length > 0 ? (
              stream.destinations.map((d, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-slate-200 font-semibold">{d.label || d.platform.toUpperCase()}</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800/40 font-mono">
                    Restreaming Active
                  </span>
                </div>
              ))
            ) : (
              <div className="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/60 flex items-center justify-between text-slate-400">
                <span>Multi-casting channels</span>
                <span className="text-[10px]">Upgrade to Pro/Business</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center space-x-1.5 text-[11px]">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>Telemetry fed via Redis pub/sub channel <code className="text-slate-300 font-mono">stream:telemetry:{stream.id.slice(0, 8)}</code></span>
          </span>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
          >
            Close Telemetry
          </button>
        </div>
      </div>
    </div>
  );
};
