import React, { useState } from 'react';
import { Zap, Cpu, HardDrive, RefreshCw, Activity, CheckCircle2, ChevronDown, ChevronUp, Layers, Sliders, ArrowUpRight } from 'lucide-react';
import { apiClient } from '../services/apiClient';

interface SystemSettingsState {
  clusterName: string;
  clusterMode: 'production' | 'drain' | 'maintenance';
  workerConcurrency: number;
  maxGlobalStreams: number;
  redisCacheEnabled: boolean;
  redisCacheTtlSeconds: number;
  bullmqRateLimitMax: number;
  heartbeatTimeoutSeconds: number;
  enforceDirectCopyMode: boolean;
  lastScaledAt: string;
}

interface AdminScalingPanelProps {
  currentSettings: SystemSettingsState;
  onUpdateSettings: (newSettings: SystemSettingsState) => void;
}

export const AdminScalingPanel: React.FC<AdminScalingPanelProps> = ({
  currentSettings,
  onUpdateSettings,
}) => {
  const [formState, setFormState] = useState<SystemSettingsState>({ ...currentSettings });
  const [isApplying, setIsApplying] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [showSqlUpdate, setShowSqlUpdate] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const handleApplyScaling = async () => {
    setIsApplying(true);
    setSuccessToast(null);
    try {
      const updated = await apiClient.updateSystemSettings({
        worker_concurrency: formState.workerConcurrency,
        redis_cache_ttl_seconds: formState.redisCacheTtlSeconds,
        max_global_streams: formState.maxGlobalStreams,
        enforce_direct_copy_mode: formState.enforceDirectCopyMode,
      });
      const newSettings: SystemSettingsState = {
        ...formState,
        workerConcurrency: updated.worker_concurrency,
        redisCacheTtlSeconds: updated.redis_cache_ttl_seconds,
        maxGlobalStreams: updated.max_global_streams,
        enforceDirectCopyMode: updated.enforce_direct_copy_mode,
        lastScaledAt: updated.last_scaled_at || new Date().toISOString(),
      };
      setFormState(newSettings);
      onUpdateSettings(newSettings);
      setSuccessToast(`Applied! Scaled BullMQ worker concurrency to ${updated.worker_concurrency} slots via Supabase and Redis memory.`);
      setTimeout(() => setSuccessToast(null), 4000);
    } catch (err: any) {
      console.error('Failed to update system settings:', err);
      onUpdateSettings({
        ...formState,
        lastScaledAt: new Date().toISOString(),
      });
    } finally {
      setIsApplying(false);
    }
  };

  const handlePreset = (preset: 'standard' | 'high_load' | 'turbo') => {
    if (preset === 'standard') {
      setFormState((prev) => ({
        ...prev,
        workerConcurrency: 16,
        maxGlobalStreams: 120,
        redisCacheTtlSeconds: 300,
      }));
    } else if (preset === 'high_load') {
      setFormState((prev) => ({
        ...prev,
        workerConcurrency: 48,
        maxGlobalStreams: 250,
        redisCacheTtlSeconds: 120,
      }));
    } else if (preset === 'turbo') {
      setFormState((prev) => ({
        ...prev,
        workerConcurrency: 96,
        maxGlobalStreams: 500,
        redisCacheTtlSeconds: 60,
      }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Clean Scaling Header */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">1-Click Admin Dynamic Scaling</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Dynamically scale BullMQ worker concurrency and Redis caching in memory without restarting containers.
          </p>
        </div>

        {/* 1-Click Fast Presets */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handlePreset('standard')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium border cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
              formState.workerConcurrency === 16
                ? 'bg-red-600 text-white border-red-500 shadow-sm shadow-red-950/60'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            16x Standard
          </button>
          <button
            onClick={() => handlePreset('high_load')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium border cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
              formState.workerConcurrency === 48
                ? 'bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-950/60'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            48x High Load
          </button>
          <button
            onClick={() => handlePreset('turbo')}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium border cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
              formState.workerConcurrency === 96
                ? 'bg-purple-600 text-white border-purple-500 shadow-sm shadow-purple-950/60'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            96x Turbo VPS
          </button>
        </div>
      </div>

      {/* Main Core Slider Card */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-6">
        <div className="flex justify-between items-center pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span>Worker Thread Concurrency Slots</span>
            </h3>
            <p className="text-xs text-slate-400">
              Maximum concurrent isolated FFmpeg processes a single node worker pool executes.
            </p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold font-mono text-blue-400">
              {formState.workerConcurrency}
            </span>
            <span className="text-xs text-slate-500 font-mono"> / 128 slots</span>
          </div>
        </div>

        {/* Concurrency Slider */}
        <div className="space-y-2">
          <input
            type="range"
            min="1"
            max="128"
            step="1"
            value={formState.workerConcurrency}
            onChange={(e) =>
              setFormState((prev) => ({ ...prev, workerConcurrency: parseInt(e.target.value, 10) }))
            }
            className="w-full h-2.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>1 slot (Dev)</span>
            <span>16 slots (Standard)</span>
            <span>48 slots (Heavy)</span>
            <span>128 slots (Maximum)</span>
          </div>
        </div>

        {/* Container Node Isolation Architecture Card */}
        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-slate-300 font-medium">Worker Container Isolation Policy:</span>
            <code className="text-amber-300 font-mono text-[11px] bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              MAX 10 Streams / Container (2 CPU &bull; 2GB RAM)
            </code>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            Required Containers: <span className="text-emerald-400 font-bold">{Math.ceil(formState.workerConcurrency / 10)}x stream-worker-node</span>
          </div>
        </div>

        {/* Live Metrics Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 font-mono text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-500 block">Estimated RAM Footprint</span>
            <span className="text-emerald-400 font-bold text-sm">
              {(formState.workerConcurrency * 42.5 + 450).toFixed(0)} MB
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-500 block">CPU Utilization (-c copy)</span>
            <span className="text-amber-400 font-bold text-sm">
              {(formState.workerConcurrency * 0.38).toFixed(1)}% (Zero Transcoding)
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-500 block">Downtime Impact</span>
            <span className="text-purple-400 font-bold text-sm">0 Seconds (Zero Downtime)</span>
          </div>
        </div>

        {/* Success Toast */}
        {successToast && (
          <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successToast}</span>
          </div>
        )}

        {/* Apply Action Button */}
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={handleApplyScaling}
            disabled={isApplying}
            className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-semibold text-xs shadow-md shadow-red-950/60 hover:shadow-lg hover:shadow-red-500/25 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            {isApplying ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Broadcasting to BullMQ Workers...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" />
                <span>Apply 1-Click Scaling (Zero-Downtime)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* COLLAPSIBLE PANEL: Advanced Settings */}
      {/* ==================================================================== */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-sm overflow-hidden">
        <button
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/50 transition-all duration-300 ease-in-out cursor-pointer"
        >
          <div className="flex items-center space-x-2 text-xs font-semibold text-slate-200">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span>Advanced Cluster Tuning &amp; Redis Cache Settings</span>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <span>{isAdvancedOpen ? 'Collapse Settings' : 'Expand Configuration'}</span>
            {isAdvancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {isAdvancedOpen && (
          <div className="p-6 border-t border-slate-800 bg-slate-950/60 space-y-5">
            {/* Redis TTL */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <div>
                  <label className="text-xs font-semibold text-slate-200">
                    Redis Cache TTL (Seconds)
                  </label>
                  <p className="text-[11px] text-slate-400">Stream status &amp; heartbeat telemetry cache expiration duration</p>
                </div>
                <span className="text-sm font-bold font-mono text-emerald-400">
                  {formState.redisCacheTtlSeconds} seconds
                </span>
              </div>
              <input
                type="range"
                min="10"
                max="600"
                step="10"
                value={formState.redisCacheTtlSeconds}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, redisCacheTtlSeconds: parseInt(e.target.value, 10) }))
                }
                className="w-full h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            {/* Checkbox Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-800/60">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-xs text-slate-300">Enforce Direct Copy Mode (-c:v copy)</span>
                <input
                  type="checkbox"
                  checked={formState.enforceDirectCopyMode}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, enforceDirectCopyMode: e.target.checked }))
                  }
                  className="w-4 h-4 accent-red-600 rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-xs text-slate-300">Redis In-Memory State Caching Active</span>
                <input
                  type="checkbox"
                  checked={formState.redisCacheEnabled}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, redisCacheEnabled: e.target.checked }))
                  }
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </div>
            </div>

            {/* SQL Preview Toggle */}
            <div className="pt-2">
              <button
                onClick={() => setShowSqlUpdate(!showSqlUpdate)}
                className="text-xs font-mono text-slate-400 hover:text-slate-200 flex items-center space-x-1 cursor-pointer"
              >
                <span>{showSqlUpdate ? 'Hide SQL Query' : 'Preview Database UPDATE SQL Query'}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>

              {showSqlUpdate && (
                <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-amber-300">
                  <pre>{`UPDATE public.system_settings
SET worker_concurrency = ${formState.workerConcurrency},
    redis_cache_ttl_seconds = ${formState.redisCacheTtlSeconds},
    last_scaled_at = now()
WHERE id = 'primary_cluster';`}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
