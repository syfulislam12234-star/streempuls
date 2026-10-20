import React, { useState, useEffect } from 'react';
import {
  Play,
  X,
  ExternalLink,
  Loader2,
  Clock,
  Sparkles,
  BookOpen,
  Filter,
} from 'lucide-react';
import { apiClient, TutorialVideo, UserProfile } from '../services/apiClient';

interface TutorialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
}

type TutorialCategory = 'all' | 'getting_started' | 'youtube_setup' | 'stream_keys' | 'troubleshooting' | 'pro_tips';

export const TutorialsModal: React.FC<TutorialsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [tutorials, setTutorials] = useState<TutorialVideo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<TutorialCategory>('all');
  const [activeVideo, setActiveVideo] = useState<TutorialVideo | null>(null);

  const fetchTutorials = async () => {
    setIsLoading(true);
    try {
      const list = await apiClient.getTutorials();
      setTutorials(list);
      if (list.length > 0 && !activeVideo) {
        setActiveVideo(list[0]);
      }
    } catch (e) {
      console.warn('Failed to load tutorials:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTutorials();
    }
  }, [isOpen]);

  // Convert YouTube link into clean embed URL
  const getEmbedUrl = (t: TutorialVideo) => {
    if (t.youtube_id) {
      return `https://www.youtube-nocookie.com/embed/${t.youtube_id}?autoplay=1&rel=0&modestbranding=1`;
    }
    const match = t.video_url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
    if (match) {
      return `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&rel=0&modestbranding=1`;
    }
    return t.video_url;
  };

  const categoriesList: { id: TutorialCategory; label: string }[] = [
    { id: 'all', label: 'All Guides' },
    { id: 'getting_started', label: 'Getting Started' },
    { id: 'youtube_setup', label: 'YouTube Setup' },
    { id: 'stream_keys', label: 'Stream Keys' },
    { id: 'pro_tips', label: 'Pro Tips (0% CPU)' },
    { id: 'troubleshooting', label: 'Troubleshooting' },
  ];

  const filteredTutorials = tutorials.filter((t) => {
    if (selectedCategory === 'all') return true;
    return t.category === selectedCategory;
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-5xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-600 to-rose-600 flex items-center justify-center text-white shadow-md shadow-red-950/50">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white tracking-tight">StreamPulse Video Guides &amp; Tutorials</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-800/60">
                  24/7 Setup
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Master 24/7 continuous live streaming, YouTube RTMP keys, and direct-copy zero-CPU mode
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Interactive Video Player & Guides Gallery */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Category Filter Pills */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-thin">
            <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0 ml-1" />
            {categoriesList.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer border ${
                  selectedCategory === cat.id
                    ? 'bg-red-600 text-white border-red-500 shadow-md shadow-red-950/50'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Main Stage: Responsive Video Player */}
          {activeVideo && (
            <div className="rounded-3xl bg-slate-950 border border-slate-800/80 p-4 sm:p-5 space-y-4 shadow-xl">
              <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl">
                {activeVideo.youtube_id || activeVideo.video_url.includes('youtube') ? (
                  <iframe
                    src={getEmbedUrl(activeVideo)}
                    title={activeVideo.title}
                    className="w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : (
                  <video
                    src={activeVideo.video_url}
                    controls
                    autoPlay
                    className="w-full h-full object-contain"
                  />
                )}
              </div>

              {/* Active Video Metadata */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pt-1">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                      {activeVideo.category.replace('_', ' ')}
                    </span>
                    {activeVideo.duration_minutes && (
                      <span className="text-[11px] text-slate-400 flex items-center space-x-1 font-mono">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{activeVideo.duration_minutes} mins</span>
                      </span>
                    )}
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
                    {activeVideo.title}
                  </h3>
                  {activeVideo.description && (
                    <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
                      {activeVideo.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <a
                    href={activeVideo.video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center space-x-1.5 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>YouTube</span>
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Tutorials Gallery Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
              <span>All Guides ({filteredTutorials.length})</span>
              <span className="text-[11px] text-slate-500">Click any card to play in high-definition</span>
            </div>

            {isLoading && tutorials.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-950/40 border border-slate-800 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-red-500 mx-auto" />
                <p className="text-xs text-slate-400">Loading guide video library...</p>
              </div>
            ) : filteredTutorials.length === 0 ? (
              <div className="p-8 text-center rounded-2xl bg-slate-950/40 border border-slate-800 text-xs text-slate-400">
                No tutorial videos found under this category filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredTutorials.map((tut) => {
                  const isSelected = activeVideo?.id === tut.id;
                  const poster =
                    tut.thumbnail_url ||
                    (tut.youtube_id
                      ? `https://img.youtube.com/vi/${tut.youtube_id}/mqdefault.jpg`
                      : 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop&q=60');

                  return (
                    <div
                      key={tut.id}
                      onClick={() => setActiveVideo(tut)}
                      className={`group rounded-2xl p-3 border transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer relative flex flex-col justify-between ${
                        isSelected
                          ? 'bg-slate-950 border-red-500/80 shadow-lg shadow-red-950/40 ring-1 ring-red-500/50'
                          : 'bg-slate-950/60 hover:bg-slate-950 border-slate-800/80 hover:border-slate-700 shadow-md'
                      }`}
                    >
                      <div className="space-y-2.5">
                        {/* Thumbnail / Poster */}
                        <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-slate-800/80">
                          <img
                            src={poster}
                            alt={tut.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop&q=60';
                            }}
                          />
                          <div className="absolute inset-0 bg-slate-950/30 group-hover:bg-slate-950/10 transition-colors flex items-center justify-center">
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out ${
                                isSelected
                                  ? 'bg-red-600 text-white shadow-lg shadow-red-900/80 scale-110'
                                  : 'bg-slate-950/80 text-white group-hover:bg-red-600 group-hover:scale-110'
                              }`}
                            >
                              <Play className="w-4 h-4 ml-0.5 fill-current" />
                            </div>
                          </div>

                          {tut.duration_minutes && (
                            <span className="absolute bottom-1.5 right-1.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/80 text-white">
                              {tut.duration_minutes}:00
                            </span>
                          )}
                        </div>

                        {/* Info */}
                        <div className="space-y-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-red-400">
                            {tut.category.replace('_', ' ')}
                          </span>
                          <h4 className="text-xs font-bold text-white line-clamp-2 leading-snug">
                            {tut.title}
                          </h4>
                          {tut.description && (
                            <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                              {tut.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Card Footer */}
                      <div className="pt-2 mt-2 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-500">
                        <span>{tut.created_by || 'StreamPulse'}</span>
                        <span className="text-red-400 font-semibold group-hover:underline">Watch &rarr;</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick 24/7 Setup Checklist Info Card */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 space-y-2">
            <div className="flex items-center space-x-2 text-white font-bold">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>3 Quick Steps to Go Live 24/7:</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-[11px]">
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-1">
                <span className="font-bold text-slate-200 block">1. Select Loop Video</span>
                <p className="text-slate-400">Choose any MP4 file or upload up to 5GB in Supabase Storage.</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-1">
                <span className="font-bold text-slate-200 block">2. Paste RTMP Key</span>
                <p className="text-slate-400">Copy the stream key from YouTube Live Studio into StreamPulse.</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-1">
                <span className="font-bold text-slate-200 block">3. Click Launch Stream</span>
                <p className="text-slate-400">Worker broadcasts continuously with direct copy encoding (-c:v copy).</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
