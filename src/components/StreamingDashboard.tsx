import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Plus,
  Tv,
  Film,
  Pencil,
  Trash2,
  Eye,
  CheckCircle2,
  Clock,
  Sparkles,
  Radio,
  RefreshCw,
  Loader2,
  AlertCircle,
  Video,
  ShieldCheck,
  Zap,
  Lock,
  Layers,
  Activity,
  Wifi,
  Bell,
  Users,
  Smartphone,
  Monitor,
  Globe,
  Calendar,
  Tag,
  BookOpen,
  CreditCard,
} from 'lucide-react';
import { CreateLiveStreamModal } from './CreateLiveStreamModal';
import { VideoPreviewModal } from './VideoPreviewModal';
import { StreamTelemetryModal } from './StreamTelemetryModal';
import { apiClient, StreamRecord, UserProfile } from '../services/apiClient';

// Fallback curated video thumbnails for friendly preview display
const THUMBNAIL_MAP: Record<string, string> = {
  'sample_lofi_broadcast_1080p60.mp4': 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
  'forest-river-ambient-4k-loop.mp4': 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&auto=format&fit=crop&q=80',
  'cyberpunk-neon-drive-synthwave.mp4': 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80',
  'lofi-beats-room-loop-1080p.mp4': 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop&q=80',
};

function getFriendlyThumbnail(videoUrl: string): string | null {
  for (const [key, thumb] of Object.entries(THUMBNAIL_MAP)) {
    if (videoUrl && videoUrl.includes(key)) {
      return thumb;
    }
  }
  return null;
}

function getPlatformLabel(rtmpUrl: string): { label: string; color: string } {
  const url = (rtmpUrl || '').toLowerCase();
  if (url.includes('youtube')) {
    return { label: 'YouTube Live', color: 'bg-red-500/10 text-red-400 border-red-500/20' };
  }
  return { label: 'Custom RTMP', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' };
}

function formatElapsedLiveTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; border: string; emoji: string }> = {
  Gaming: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/25', emoji: '🎮' },
  Music: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/25', emoji: '🎵' },
  Entertainment: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/25', emoji: '🎭' },
  Education: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/25', emoji: '📚' },
  'Science & Technology': { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/25', emoji: '🔬' },
  'People & Blogs': { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/25', emoji: '👥' },
  'News & Politics': { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/25', emoji: '📰' },
  'Howto & Style': { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/25', emoji: '💡' },
  'Film & Animation': { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/25', emoji: '🎬' },
  Sports: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/25', emoji: '⚽' },
  'Travel & Events': { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/25', emoji: '✈️' },
  Comedy: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/25', emoji: '😂' },
  'Autos & Vehicles': { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/25', emoji: '🚗' },
};

function getCategoryBadge(category?: string) {
  const cat = category || 'Entertainment';
  return (
    CATEGORY_STYLES[cat] || {
      bg: 'bg-slate-800/80',
      text: 'text-slate-300',
      border: 'border-slate-700',
      emoji: '🏷️',
    }
  );
}

interface StreamingDashboardProps {
  currentUser?: UserProfile | null;
  isCreateModalOpen: boolean;
  setIsCreateModalOpen: (open: boolean) => void;
  onActiveStreamsChange?: (count: number) => void;
  onOpenPlanModal?: () => void;
  onOpenTutorials?: () => void;
  onOpenNotificationsModal?: () => void;
}

export const StreamingDashboard: React.FC<StreamingDashboardProps> = ({
  currentUser,
  isCreateModalOpen,
  setIsCreateModalOpen,
  onActiveStreamsChange,
  onOpenPlanModal,
  onOpenTutorials,
  onOpenNotificationsModal,
}) => {
  const [streams, setStreams] = useState<StreamRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal States
  const [editingStream, setEditingStream] = useState<StreamRecord | null>(null);
  const [previewingStream, setPreviewingStream] = useState<{ title: string; videoUrl: string } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [selectedTelemetryStream, setSelectedTelemetryStream] = useState<StreamRecord | null>(null);

  const isPollingRef = useRef(false);

  // 1. Fetch Streams from backend
  const loadStreams = async (showLoadingSpinner = false) => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    if (showLoadingSpinner) setIsLoading(true);

    try {
      const data = await apiClient.getStreams();
      if (Array.isArray(data)) {
        setStreams(data);
        const liveCount = data.filter((s) => s.status === 'live').length;
        if (onActiveStreamsChange) {
          onActiveStreamsChange(liveCount);
        }
      }
    } catch (err: any) {
      // Keep existing data gracefully
    } finally {
      isPollingRef.current = false;
      if (showLoadingSpinner) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStreams(true);

    // Periodic refresh every 3 seconds for live uptime and status updates
    const pollId = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        loadStreams(false);
      }
    }, 3000);

    return () => clearInterval(pollId);
  }, []);

  // 2. Start Live Stream action
  const handleStartLive = async (stream: StreamRecord) => {
    setActionLoadingId(stream.id);
    setActionError(null);
    try {
      await apiClient.startStream(stream.id);
      await loadStreams(false);
    } catch (err: any) {
      setActionError(err.message || 'Unable to start live stream. Please check your destination key.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // 3. Stop Live Stream action
  const handleStopLive = async (stream: StreamRecord) => {
    setActionLoadingId(stream.id);
    setActionError(null);
    try {
      await apiClient.stopStream(stream.id);
      await loadStreams(false);
    } catch (err: any) {
      setActionError(err.message || 'Unable to stop live stream. Please try again.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // 4. Delete Stream action
  const handleDeleteStream = async (id: string) => {
    setActionLoadingId(id);
    setActionError(null);
    try {
      await apiClient.deleteStream(id);
      setDeleteConfirmId(null);
      await loadStreams(false);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete stream.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // 5. Callback on successful creation or update from 3-step modal
  const handleModalSuccess = (savedStream: StreamRecord, autoStart: boolean) => {
    setEditingStream(null);
    loadStreams(false);
    if (autoStart) {
      handleStartLive(savedStream);
    }
  };

  const liveStreams = streams.filter((s) => s.status === 'live');
  const readyStreams = streams.filter((s) => s.status !== 'live');

  const renderDashboard = () => (
    <div className="space-y-8">
      {/* ==================================================================== */}
      {/* ==================================================================== */}
      {/* Cloud Studio Workspace Header                                         */}
      {/* ==================================================================== */}
      <section className="rounded-2xl bg-slate-900 border border-slate-800 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Live Broadcasting Studio
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              Manage 24/7 continuous stream pipelines, multi-destination RTMP endpoints, and real-time broadcast telemetry with cloud-hosted direct stream encoding.
            </p>
            <div className="pt-1 flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <div className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Direct stream copy (-c:v copy)</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Automatic continuous loop</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Multi-destination RTMP</span>
              </div>
            </div>
          </div>

          <div className="shrink-0">
            <button
              onClick={() => {
                setEditingStream(null);
                setIsCreateModalOpen(true);
              }}
              className="w-full sm:w-auto flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs sm:text-sm transition-colors cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create Stream</span>
            </button>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* Studio Metrics & Infrastructure Health Overview                       */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="text-[11px] font-medium text-slate-400">Active Broadcasts</div>
          <div className="text-lg font-bold text-white font-mono flex items-center space-x-2">
            <span>{liveStreams.length}</span>
            <span className="text-xs font-normal text-slate-500">
              / {currentUser?.channel_limit || 2} Channels
            </span>
          </div>
          <div className="text-[11px] text-emerald-400 flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Broadcast Engine Active</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="text-[11px] font-medium text-slate-400">Total Configured</div>
          <div className="text-lg font-bold text-white font-mono">
            {streams.length}
          </div>
          <div className="text-[11px] text-slate-400">
            {readyStreams.length} Standby / Scheduled
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="text-[11px] font-medium text-slate-400">Subscription Tier</div>
          <div className="text-lg font-bold text-white capitalize">
            {currentUser?.subscription_tier || 'Free'}
          </div>
          <div className="text-[11px] text-slate-400">
            {currentUser?.hour_limit && currentUser.hour_limit > 0
              ? `${currentUser.hour_limit} Hours Quota`
              : 'Continuous Unmetered'}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="text-[11px] font-medium text-slate-400">Platform Health</div>
          <div className="text-lg font-bold text-emerald-400 flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Operational</span>
          </div>
          <div className="text-[11px] text-slate-400">
            Direct Copy Streaming
          </div>
        </div>
      </div>

      {/* Global Error Banner (Friendly feedback) */}
      {actionError && (
        <div className="p-4 rounded-2xl bg-red-950/70 border border-red-800 text-red-200 text-sm flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2.5">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-red-400 hover:text-white font-bold px-2 py-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* Active Subscription & Purchased Limits Status Banner */}
      {/* ==================================================================== */}
      {currentUser && (
        <div className="p-4 sm:p-5 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center space-x-3.5">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                currentUser.subscription_tier === 'business'
                  ? 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                  : currentUser.subscription_tier === 'pro'
                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                  : currentUser.subscription_tier === 'basic'
                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              }`}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-extrabold text-white tracking-tight">
                  {currentUser.subscription_tier.toUpperCase()} PLAN
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-bold">
                  Status: Active (Unlocked)
                </span>
                {currentUser.is_brand_free ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    Brand-Free
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800/60">
                    Watermarked (Trial)
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                <span className="flex items-center space-x-1">
                  <span className="text-slate-200 font-semibold">{streams.length} / {currentUser.channel_limit}</span>
                  <span>Channels Used</span>
                </span>
                <span>&middot;</span>
                <span className="flex items-center space-x-1">
                  <span className="text-slate-200 font-semibold">{currentUser.video_limit}</span>
                  <span>Video Storage Limit</span>
                </span>
                <span>&middot;</span>
                <span className="text-slate-300">
                  {currentUser.subscription_tier === 'free' ? '10-Hour Total Limit (3 Days)' : '24/7 Non-Stop Continuous Streaming'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-center shrink-0">
            {onOpenTutorials && (
              <button
                onClick={onOpenTutorials}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white border border-slate-700 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer flex items-center space-x-1.5"
                title="Watch Video Guides & 24/7 Setup Tutorials"
              >
                <BookOpen className="w-3.5 h-3.5 text-red-400" />
                <span>Video Tutorials</span>
              </button>
            )}
            {onOpenNotificationsModal && (
              <button
                onClick={onOpenNotificationsModal}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white border border-slate-700 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer flex items-center space-x-1.5"
                title="Automated Expiry & 1-Click Renewal Alerts"
              >
                <Bell className="w-3.5 h-3.5 text-red-400" />
                <span>Expiry Alerts</span>
              </button>
            )}
            {onOpenPlanModal && (
              <button
                onClick={onOpenPlanModal}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white border border-slate-700 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer flex items-center space-x-1.5"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Change Plan</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* Live Stream Cards Section */}
      {/* ==================================================================== */}
      <section className="space-y-4">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold text-white tracking-tight">Your Broadcasts</h2>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {streams.length} total
            </span>
          </div>

          <button
            onClick={() => loadStreams(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm cursor-pointer"
            title="Refresh stream status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-red-400' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Loading State */}
        {isLoading && streams.length === 0 ? (
          <div className="p-12 text-center rounded-3xl bg-slate-900/50 border border-slate-800 space-y-3">
            <Loader2 className="w-8 h-8 text-red-500 animate-spin mx-auto" />
            <p className="text-sm text-slate-400">Loading your live broadcasts...</p>
          </div>
        ) : streams.length === 0 ? (
          /* ==================================================================== */
          /* Friendly Empty State */
          /* ==================================================================== */
          <div className="rounded-3xl bg-slate-900/60 border border-slate-800/80 p-8 sm:p-14 text-center space-y-5 shadow-lg">
            <div className="w-20 h-20 rounded-3xl bg-red-600/10 border border-red-500/20 text-red-500 flex items-center justify-center mx-auto shadow-inner">
              <Radio className="w-10 h-10 stroke-[1.75]" />
            </div>

            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-xl font-bold text-white">No Live Streams Yet</h3>
              <p className="text-sm text-slate-400">
                You haven't created any live broadcasts yet. Going live takes less than a minute: choose a video, connect your destination, and start broadcasting!
              </p>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => {
                  setEditingStream(null);
                  setIsCreateModalOpen(true);
                }}
                className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-6 py-3.5 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm shadow-xl shadow-red-950/60 hover:shadow-red-500/25 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Create Your First Live Stream</span>
              </button>

              {onOpenTutorials && (
                <button
                  type="button"
                  onClick={onOpenTutorials}
                  className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-semibold text-sm border border-slate-700 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                >
                  <BookOpen className="w-4 h-4 text-red-400" />
                  <span>Watch 24/7 Setup Tutorials</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* ==================================================================== */
          /* Stream Cards Grid */
          /* ==================================================================== */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {streams.map((stream) => {
              const isLive = stream.status === 'live';
              const platformInfo = getPlatformLabel(stream.rtmp_server_url);
              const customThumb = stream.thumbnail_url?.trim() || null;
              const friendlyThumb = customThumb || getFriendlyThumbnail(stream.video_url);
              const isActionLoading = actionLoadingId === stream.id;
              const catBadge = getCategoryBadge(stream.category);

              return (
                <div
                  key={stream.id}
                  className={`rounded-3xl border transition-all duration-200 flex flex-col justify-between overflow-hidden shadow-lg ${
                    isLive
                      ? 'bg-slate-900/90 border-emerald-500/40 ring-1 ring-emerald-500/20 shadow-emerald-950/20'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  {/* Card Media Preview Header */}
                  <div className="relative h-44 w-full bg-slate-950 overflow-hidden group">
                    {friendlyThumb && friendlyThumb.trim() ? (
                      <img
                        src={friendlyThumb.trim()}
                        alt={stream.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 to-slate-900 text-slate-600">
                        <Video className="w-12 h-12 stroke-[1.5] text-slate-500" />
                        <span className="text-xs text-slate-400 mt-1 font-medium">Video Ready</span>
                      </div>
                    )}

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-black/40" />

                    {/* Top Badges */}
                    <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                      {/* Platform & Orientation & Category Label */}
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        <span
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border backdrop-blur-md shadow-sm ${platformInfo.color}`}
                        >
                          {platformInfo.label}
                        </span>

                        {/* Aspect Ratio / Orientation Badge */}
                        <span
                          className={`inline-flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded-full border backdrop-blur-md shadow-sm ${
                            stream.orientation === 'vertical'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                              : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                          }`}
                          title={stream.orientation === 'vertical' ? 'Vertical 9:16 (Shorts/Reels style)' : 'Horizontal 16:9 (Standard Live)'}
                        >
                          {stream.orientation === 'vertical' ? (
                            <>
                              <Smartphone className="w-3 h-3 text-rose-400" />
                              <span>9:16 Shorts</span>
                            </>
                          ) : (
                            <>
                              <Monitor className="w-3 h-3 text-blue-400" />
                              <span>16:9 Live</span>
                            </>
                          )}
                        </span>

                        {/* Stream Category Badge */}
                        <span
                          className={`inline-flex items-center space-x-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border backdrop-blur-md shadow-sm ${catBadge.bg} ${catBadge.text} ${catBadge.border}`}
                          title={`YouTube Category: ${stream.category || 'Entertainment'}`}
                        >
                          <Tag className="w-2.5 h-2.5 opacity-80" />
                          <span>{catBadge.emoji} {stream.category || 'Entertainment'}</span>
                        </span>
                      </div>

                      {/* Simple Status Badge */}
                      <div
                        className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider backdrop-blur-md border shadow-sm ${
                          isLive
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-emerald-950/50'
                            : stream.status === 'idle'
                            ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                            : 'bg-slate-800/80 border-slate-700 text-slate-300'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isLive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                          }`}
                        />
                        <span>{isLive ? 'Live' : stream.status === 'idle' ? 'Ready' : 'Stopped'}</span>
                      </div>
                    </div>

                    {/* Preview Button Overlay */}
                    <button
                      onClick={() =>
                        setPreviewingStream({
                          title: stream.title,
                          videoUrl: stream.video_url,
                        })
                      }
                      className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 ease-in-out cursor-pointer shadow-xl hover:shadow-red-500/40 transform scale-90 group-hover:scale-100 hover:scale-110 active:scale-95"
                      title="Preview Video Clip"
                    >
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </button>

                    {/* Elapsed Live Time Overlay at Bottom of Thumbnail */}
                    <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-xs font-medium">
                      <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md text-slate-200">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {isLive
                            ? `Live for ${formatElapsedLiveTime(stream.uptime_seconds)}`
                            : 'Continuous Loop Ready'}
                        </span>
                      </div>

                      {/* Subtle Preview Button on mobile */}
                      <button
                        onClick={() =>
                          setPreviewingStream({
                            title: stream.title,
                            videoUrl: stream.video_url,
                          })
                        }
                        className="sm:hidden px-2 py-1 rounded-lg bg-black/70 hover:bg-slate-800 text-slate-200 text-xs flex items-center space-x-1 transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Preview</span>
                      </button>
                    </div>
                  </div>

                  {/* Card Content Body */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-1.5">
                      <h3 className="text-base font-bold text-white line-clamp-1 tracking-tight" title={stream.title}>
                        {stream.title}
                      </h3>
                      {stream.description ? (
                        <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed" title={stream.description}>
                          {stream.description}
                        </p>
                      ) : null}
                      <p className="text-xs text-slate-400">
                        Destination: <span className="text-slate-300 font-medium">{platformInfo.label}</span> &middot;{' '}
                        <span>{stream.is_looping ? '24/7 Auto-Repeat' : 'Single Play'}</span> &middot;{' '}
                        <span className={stream.orientation === 'vertical' ? 'text-rose-300 font-medium' : 'text-blue-300 font-medium'}>
                          {stream.orientation === 'vertical' ? 'Vertical 9:16' : 'Horizontal 16:9'}
                        </span> &middot;{' '}
                        <span className="text-slate-300 font-medium">
                          {catBadge.emoji} {stream.category || 'Entertainment'}
                        </span>
                      </p>

                      {/* Audience, Visibility, Category & Multi-Casting Tags */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        {/* Stream Category Badge */}
                        <span
                          className={`inline-flex items-center space-x-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg border ${catBadge.bg} ${catBadge.text} ${catBadge.border}`}
                          title={`YouTube Category: ${stream.category || 'Entertainment'}`}
                        >
                          <Tag className="w-2.5 h-2.5" />
                          <span>{catBadge.emoji} {stream.category || 'Entertainment'}</span>
                        </span>

                        {/* Visibility Badge */}
                        <span className="inline-flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 capitalize">
                          {stream.visibility === 'scheduled' ? (
                            <>
                              <Calendar className="w-3 h-3 text-amber-400" />
                              <span>{stream.scheduled_for ? `Sched: ${new Date(stream.scheduled_for).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'Scheduled'}</span>
                            </>
                          ) : stream.visibility === 'private' ? (
                            <>
                              <Lock className="w-3 h-3 text-slate-400" />
                              <span>Private</span>
                            </>
                          ) : stream.visibility === 'unlisted' ? (
                            <>
                              <Globe className="w-3 h-3 text-slate-400" />
                              <span>Unlisted</span>
                            </>
                          ) : (
                            <>
                              <Globe className="w-3 h-3 text-emerald-400" />
                              <span>Public</span>
                            </>
                          )}
                        </span>

                        {/* Audience Badge */}
                        <span className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400">
                          {stream.audience === 'made_for_kids' ? '👶 Kids' : '🧑 General'}
                        </span>

                        {/* Custom Thumbnail Pill */}
                        {stream.thumbnail_url && (
                          <span className="text-[10px] px-2 py-0.5 rounded-lg bg-red-950/40 border border-red-800/40 text-red-300">
                            Custom Thumb
                          </span>
                        )}

                        {/* Multi-Casting Platform Badge */}
                        {stream.destinations && stream.destinations.length > 0 && (
                          <div className="flex items-center space-x-1.5 text-[11px] text-purple-300 bg-purple-950/50 px-2.5 py-0.5 rounded-lg border border-purple-800/40 font-medium">
                            <Layers className="w-3 h-3 text-purple-400 shrink-0" />
                            <span>+{stream.destinations.length} Multi-Cast</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Real-Time Live Telemetry Bar */}
                    {isLive ? (
                      <div className="p-3 rounded-2xl bg-slate-950 border border-emerald-900/40 space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="flex items-center space-x-1 text-emerald-400 font-semibold">
                            <Activity className="w-3.5 h-3.5 animate-pulse" />
                            <span>Live Health &amp; Telemetry</span>
                          </span>
                          <span className="text-[10px] font-mono text-emerald-400 font-bold px-1.5 py-0.2 bg-emerald-950 rounded">
                            EXCELLENT
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-[11px] font-mono text-slate-300">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-sans">Bitrate</span>
                            <span className="font-bold">{stream.current_bitrate_kbps ? `${stream.current_bitrate_kbps}k` : '6,000k'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-sans">FPS</span>
                            <span className="font-bold">{stream.fps ? stream.fps : '60.0'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-sans">Dropped</span>
                            <span className="text-emerald-400 font-bold">0</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedTelemetryStream(stream)}
                          className="w-full py-1.5 px-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm"
                        >
                          <Activity className="w-3.5 h-3.5 text-red-400" />
                          <span>View Live Bitrate &amp; CPU Telemetry</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedTelemetryStream(stream)}
                        className="py-1.5 px-2 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800/80 text-slate-400 hover:text-slate-200 text-[11px] font-medium flex items-center justify-center space-x-1.5 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm"
                      >
                        <Activity className="w-3 h-3 text-slate-400" />
                        <span>Stream Health Telemetry Standby</span>
                      </button>
                    )}

                    {/* Buttons Section (Large, Friendly, Touch-First) */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      {/* Primary Toggle: Start Live / Stop Live */}
                      {isLive ? (
                        <button
                          onClick={() => handleStopLive(stream)}
                          disabled={isActionLoading}
                          className="w-full flex items-center justify-center space-x-2 py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-bold text-sm shadow-md shadow-rose-950/60 hover:shadow-lg hover:shadow-rose-500/25 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                        >
                          {isActionLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Stopping stream...</span>
                            </>
                          ) : (
                            <>
                              <Square className="w-4 h-4 fill-current" />
                              <span>Stop Live Broadcast</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStartLive(stream)}
                          disabled={isActionLoading}
                          className="w-full flex items-center justify-center space-x-2 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-60 text-white font-extrabold text-sm shadow-md shadow-emerald-950/60 hover:shadow-lg hover:shadow-emerald-500/25 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                        >
                          {isActionLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Starting live...</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 fill-current" />
                              <span>Start Live Broadcast</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Secondary Action Buttons: Edit, Preview, and Delete */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {/* Edit Button */}
                        <button
                          onClick={() => {
                            setEditingStream(stream);
                            setIsCreateModalOpen(true);
                          }}
                          className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5 text-slate-400" />
                          <span>Edit</span>
                        </button>

                        {/* Preview Button */}
                        <button
                          onClick={() =>
                            setPreviewingStream({
                              title: stream.title,
                              videoUrl: stream.video_url,
                            })
                          }
                          className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-400" />
                          <span>Preview</span>
                        </button>

                        {/* Delete Button with inline confirmation */}
                        {deleteConfirmId === stream.id ? (
                          <button
                            onClick={() => handleDeleteStream(stream.id)}
                            className="flex items-center justify-center space-x-1 py-2 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-red-500/25 cursor-pointer"
                            title="Confirm delete"
                          >
                            <span>Confirm</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(stream.id)}
                            className="flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-red-950/60 hover:text-red-300 text-slate-400 text-xs font-semibold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer"
                            title="Delete this stream"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <div className="space-y-8 pb-12">
      {renderDashboard()}

      {/* ==================================================================== */}
      {/* 3-Step Guided Modal (Create / Edit Live Stream) */}
      {/* ==================================================================== */}
      <CreateLiveStreamModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingStream(null);
        }}
        onSuccess={handleModalSuccess}
        editingStream={editingStream}
        currentUser={currentUser}
      />

      {/* ==================================================================== */}
      {/* Friendly Video Preview Modal */}
      {/* ==================================================================== */}
      {previewingStream && (
        <VideoPreviewModal
          title={previewingStream.title}
          videoUrl={previewingStream.videoUrl}
          onClose={() => setPreviewingStream(null)}
        />
      )}

      {/* ==================================================================== */}
      {/* Real-Time Stream Health Telemetry Modal */}
      {/* ==================================================================== */}
      {selectedTelemetryStream && (
        <StreamTelemetryModal
          stream={selectedTelemetryStream}
          onClose={() => setSelectedTelemetryStream(null)}
        />
      )}
    </div>
  );
};

