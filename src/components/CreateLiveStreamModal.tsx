import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Upload,
  Film,
  Play,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Radio,
  Sparkles,
  Repeat,
  ShieldCheck,
  HelpCircle,
  Video,
  Loader2,
  AlertCircle,
  Layers,
  Tv,
  Trash2,
  Plus,
  Smartphone,
  Monitor,
  Image as ImageIcon,
  Globe,
  Lock,
  Users,
  Calendar,
  Clock,
  Smile,
  UserCheck,
  Link as LinkIcon,
  Tag,
  ChevronDown,
} from 'lucide-react';
import {
  apiClient,
  StreamRecord,
  UserProfile,
  StreamDestination,
  StreamAudience,
  StreamVisibility,
  StreamCategory,
} from '../services/apiClient';

interface CuratedVideo {
  title: string;
  url: string;
  duration: string;
  description: string;
  category: string;
  thumbnail: string;
}

const CURATED_LIBRARY: CuratedVideo[] = [
  {
    title: '24/7 Lofi Ambient Chill Beats',
    url: '/uploads/sample_lofi_broadcast_1080p60.mp4',
    duration: '3:00 Loop',
    description: 'Relaxing ambient beats for studying, focus, and chillout streams.',
    category: 'Music & Lofi',
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
  },
  {
    title: 'Peaceful Mountain Forest & River',
    url: 'https://wkchgdchgeormxvvlude.supabase.co/storage/v1/object/public/stream-assets/forest-river-ambient-4k-loop.mp4',
    duration: '4:00 Loop',
    description: 'Gentle river sounds and pristine green pine forest scenery.',
    category: 'Nature & Zen',
    thumbnail: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&auto=format&fit=crop&q=80',
  },
  {
    title: 'Cyberpunk Synthwave Neon Drive',
    url: 'https://wkchgdchgeormxvvlude.supabase.co/storage/v1/object/public/stream-assets/cyberpunk-neon-drive-synthwave.mp4',
    duration: '2:00 Loop',
    description: 'Retro 80s futuristic highway drive with glowing city skyline.',
    category: 'Retro & Gaming',
    thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80',
  },
  {
    title: 'Lofi Hip Hop Study Room',
    url: 'https://wkchgdchgeormxvvlude.supabase.co/storage/v1/object/public/stream-assets/lofi-beats-room-loop-1080p.mp4',
    duration: '3:00 Loop',
    description: 'Cozy bedroom aesthetic with desk lamp and chill background groove.',
    category: 'Study & Work',
    thumbnail: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop&q=80',
  },
];

export const YOUTUBE_CATEGORIES: { id: StreamCategory; label: string; iconEmoji: string }[] = [
  { id: 'Entertainment', label: 'Entertainment', iconEmoji: '🎭' },
  { id: 'Gaming', label: 'Gaming', iconEmoji: '🎮' },
  { id: 'Music', label: 'Music', iconEmoji: '🎵' },
  { id: 'Education', label: 'Education', iconEmoji: '📚' },
  { id: 'Science & Technology', label: 'Science & Technology', iconEmoji: '🔬' },
  { id: 'People & Blogs', label: 'People & Blogs', iconEmoji: '👥' },
  { id: 'News & Politics', label: 'News & Politics', iconEmoji: '📰' },
  { id: 'Howto & Style', label: 'Howto & Style', iconEmoji: '💡' },
  { id: 'Film & Animation', label: 'Film & Animation', iconEmoji: '🎬' },
  { id: 'Sports', label: 'Sports', iconEmoji: '⚽' },
  { id: 'Travel & Events', label: 'Travel & Events', iconEmoji: '✈️' },
  { id: 'Comedy', label: 'Comedy', iconEmoji: '😂' },
  { id: 'Autos & Vehicles', label: 'Autos & Vehicles', iconEmoji: '🚗' },
];

interface CreateLiveStreamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (stream: StreamRecord, autoStart: boolean) => void;
  editingStream?: StreamRecord | null;
  currentUser?: UserProfile | null;
}

export const CreateLiveStreamModal: React.FC<CreateLiveStreamModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  editingStream,
  currentUser,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Video State
  const [videoSourceMode, setVideoSourceMode] = useState<'upload' | 'library'>('library');
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string>('');
  const [selectedVideoTitle, setSelectedVideoTitle] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [userUploads, setUserUploads] = useState<any[]>([]);
  const [isInlinePreviewOpen, setIsInlinePreviewOpen] = useState(false);

  // Step 2: Destination State
  const [platform, setPlatform] = useState<'youtube' | 'custom'>('youtube');
  const [streamUrl, setStreamUrl] = useState<string>('rtmp://a.rtmp.youtube.com/live2');
  const [streamKey, setStreamKey] = useState<string>('');
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [connectionTestStatus, setConnectionTestStatus] = useState<{
    tested: boolean;
    success: boolean;
    message: string;
  } | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  // Multi-Platform Multi-Casting (Restreaming) state:
  // Pro: up to 2 destinations, Business: up to 4 destinations, Free & Basic: 1 destination
  const maxAllowedDestinations = currentUser?.subscription_tier === 'business' ? 4 :
                                 currentUser?.subscription_tier === 'pro' ? 2 : 1;
  const [secondaryDestinations, setSecondaryDestinations] = useState<StreamDestination[]>([]);

  // Step 3: Review & Options
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [category, setCategory] = useState<string>('Entertainment');
  const [audience, setAudience] = useState<StreamAudience>('not_for_kids');
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [thumbnailMode, setThumbnailMode] = useState<'url' | 'upload'>('url');
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const [thumbUploadError, setThumbUploadError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<StreamVisibility>('public');
  const [scheduledFor, setScheduledFor] = useState<string>('');
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [qualityOption, setQualityOption] = useState<'original' | '1080p' | '720p'>('original');
  const [streamTitle, setStreamTitle] = useState<string>('');
  const [streamDescription, setStreamDescription] = useState<string>('');
  const [titleTouched, setTitleTouched] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // Initialize or prefill state
  useEffect(() => {
    if (editingStream) {
      setSelectedVideoUrl(editingStream.video_url);
      setSelectedVideoTitle(editingStream.title);
      setStreamTitle(editingStream.title);
      setStreamDescription(editingStream.description || '');
      setStreamKey(editingStream.stream_key);
      setStreamUrl(editingStream.rtmp_server_url || 'rtmp://a.rtmp.youtube.com/live2');
      setIsLooping(editingStream.is_looping ?? true);
      setOrientation(editingStream.orientation === 'vertical' ? 'vertical' : 'horizontal');
      setCategory(editingStream.category || 'Entertainment');
      setAudience(editingStream.audience || 'not_for_kids');
      setThumbnailUrl(editingStream.thumbnail_url || '');
      setVisibility(editingStream.visibility || 'public');
      setScheduledFor(editingStream.scheduled_for ? editingStream.scheduled_for.slice(0, 16) : '');
      setTitleTouched(false);
      setSubmitError(null);
      setThumbUploadError(null);

      if (editingStream.rtmp_server_url?.includes('youtube')) {
        setPlatform('youtube');
      } else {
        setPlatform('custom');
      }
      if (Array.isArray(editingStream.destinations)) {
        setSecondaryDestinations(editingStream.destinations);
      } else {
        setSecondaryDestinations([]);
      }
      setStep(1);
    } else if (isOpen) {
      // Default for new stream
      setSecondaryDestinations([]);
      setOrientation('horizontal');
      setCategory('Entertainment');
      setAudience('not_for_kids');
      setThumbnailUrl('');
      setVisibility('public');
      setScheduledFor('');
      setThumbUploadError(null);
      if (!selectedVideoUrl && CURATED_LIBRARY.length > 0) {
        setSelectedVideoUrl(CURATED_LIBRARY[0].url);
        setSelectedVideoTitle(CURATED_LIBRARY[0].title);
        setStreamTitle(CURATED_LIBRARY[0].title);
        setCategory('Music');
      }
      setSubmitError(null);
    }
  }, [editingStream, isOpen]);

  // Load uploaded videos from library
  useEffect(() => {
    if (isOpen) {
      apiClient.getUploads().then((items) => {
        if (Array.isArray(items)) setUserUploads(items);
      }).catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle platform button change
  const handlePlatformSelect = (p: 'youtube' | 'custom') => {
    setPlatform(p);
    setConnectionTestStatus(null);
    if (p === 'youtube') {
      setStreamUrl('rtmp://a.rtmp.youtube.com/live2');
    } else {
      if (streamUrl.includes('youtube')) {
        setStreamUrl('');
      }
    }
  };

  // Upload handler
  const handleFileUpload = async (file: File) => {
    if (!file.name.match(/\.(mp4|mov|mkv|m4v)$/i)) {
      setUploadError('Please select a video file (MP4, MOV, or MKV format).');
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(10);

    try {
      const asset = await apiClient.uploadDirectToR2(file, (percent) => {
        setUploadProgress(percent);
      });
      setSelectedVideoUrl(asset.url);
      const cleanName = asset.titleSuggestion || file.name.replace(/\.[^/.]+$/, '');
      setSelectedVideoTitle(cleanName);
      if (!titleTouched || !streamTitle.trim()) {
        setStreamTitle(cleanName);
      }
      setUploadProgress(100);
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(null);
      }, 600);
    } catch (err: any) {
      setUploadError(err.message || 'Video upload failed. Please try again.');
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  // Thumbnail upload handler
  const handleThumbnailUpload = async (file: File) => {
    if (!file.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
      setThumbUploadError('Please select a valid image file (JPG, PNG, or WebP).');
      return;
    }
    setThumbUploadError(null);
    setIsUploadingThumb(true);
    try {
      const asset = await apiClient.uploadVideo(file);
      if (asset?.url) {
        setThumbnailUrl(asset.url);
      }
    } catch (err: any) {
      setThumbUploadError(err.message || 'Image upload failed. You can also paste an image URL directly.');
    } finally {
      setIsUploadingThumb(false);
    }
  };

  // Safe connection test action
  const handleTestConnection = async () => {
    if (!streamKey.trim()) {
      setConnectionTestStatus({
        tested: true,
        success: false,
        message: 'Please enter your stream key first.',
      });
      return;
    }
    if (!streamUrl.trim()) {
      setConnectionTestStatus({
        tested: true,
        success: false,
        message: 'Please enter a valid stream destination URL.',
      });
      return;
    }

    setIsTestingConnection(true);
    setConnectionTestStatus(null);
    try {
      const res = await apiClient.testConnection(streamUrl.trim(), streamKey.trim());
      setConnectionTestStatus({
        tested: true,
        success: true,
        message: res.message || `Connection ready! Verified ${platform === 'youtube' ? 'YouTube Live' : 'Custom RTMP'} destination.`,
      });
    } catch (err: any) {
      setConnectionTestStatus({
        tested: true,
        success: false,
        message: err.message || 'Unable to verify connection. Please double check your stream address and key.',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Submit and optionally auto-start
  const handleSubmit = async (autoStart: boolean) => {
    if (!selectedVideoUrl) {
      setSubmitError('Please choose a video in Step 1.');
      setStep(1);
      return;
    }
    if (!streamKey.trim()) {
      setSubmitError('Please enter a stream key in Step 2.');
      setStep(2);
      return;
    }
    if (!streamTitle.trim()) {
      setTitleTouched(true);
      setSubmitError('Stream title is required. Please enter a title for your live broadcast.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const titleToUse = streamTitle.trim().slice(0, 100);
    const descriptionToUse = streamDescription.trim().slice(0, 500);
    const validDestinations = secondaryDestinations
      .filter((d) => d.isEnabled && d.streamKey?.trim())
      .slice(0, Math.max(0, maxAllowedDestinations - 1));

    try {
      let resultStream: StreamRecord;
      const scheduledIso = scheduledFor ? new Date(scheduledFor).toISOString() : undefined;

      if (editingStream) {
        resultStream = await apiClient.updateStream(editingStream.id, {
          title: titleToUse,
          description: descriptionToUse,
          videoUrl: selectedVideoUrl,
          thumbnailUrl: thumbnailUrl.trim() || undefined,
          streamKey: streamKey.trim(),
          rtmpServerUrl: streamUrl.trim(),
          isLooping,
          orientation,
          category,
          audience,
          visibility,
          scheduledFor: visibility === 'scheduled' ? scheduledIso : undefined,
          destinations: validDestinations,
        });
      } else {
        resultStream = await apiClient.createStream({
          title: titleToUse,
          description: descriptionToUse,
          videoUrl: selectedVideoUrl,
          thumbnailUrl: thumbnailUrl.trim() || undefined,
          streamKey: streamKey.trim(),
          rtmpServerUrl: streamUrl.trim(),
          isLooping,
          orientation,
          category,
          audience,
          visibility,
          scheduledFor: visibility === 'scheduled' ? scheduledIso : undefined,
          directCopyMode: orientation === 'horizontal',
          destinations: validDestinations,
        });
      }

      onSuccess(resultStream, autoStart);
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to save stream. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col my-auto transition-all animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                {editingStream ? 'Edit Live Stream' : 'Create Live Stream'}
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Set up your 24/7 live broadcast in 3 simple steps
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-all duration-300 ease-in-out hover:scale-105 active:scale-95"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3-Step Guided Stepper Bar */}
        <div className="px-5 sm:px-8 py-3.5 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between">
          {[
            { num: 1, label: 'Choose Video' },
            { num: 2, label: 'Connect Destination' },
            { num: 3, label: 'Review & Go Live' },
          ].map((item, idx) => {
            const isActive = step === item.num;
            const isDone = step > item.num;
            return (
              <React.Fragment key={item.num}>
                <div
                  onClick={() => {
                    if (isDone) setStep(item.num as any);
                  }}
                  className={`flex items-center space-x-2 cursor-pointer select-none transition-colors ${
                    isActive
                      ? 'text-white'
                      : isDone
                      ? 'text-emerald-400 hover:text-emerald-300'
                      : 'text-slate-500'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 ${
                      isActive
                        ? 'bg-red-600 text-white ring-4 ring-red-950 shadow-md shadow-red-950/60'
                        : isDone
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isDone ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : item.num}
                  </div>
                  <span className="text-xs font-semibold hidden sm:inline">
                    {item.label}
                  </span>
                </div>
                {idx < 2 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 rounded-full transition-colors ${
                      step > idx + 1 ? 'bg-emerald-500/50' : 'bg-slate-800'
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-7 overflow-y-auto max-h-[65vh] space-y-6">

          {/* ================================================================ */}
          {/* STEP 1: CHOOSE VIDEO */}
          {/* ================================================================ */}
          {step === 1 && (
            <div className="space-y-6">
              {/* Option Selector Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setVideoSourceMode('library')}
                  className={`p-4 rounded-2xl border text-left flex items-start space-x-3 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
                    videoSourceMode === 'library'
                      ? 'bg-red-950/30 border-red-500 text-white shadow-md shadow-red-950/40 ring-1 ring-red-500/30'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl ${videoSourceMode === 'library' ? 'bg-red-600 text-white shadow-sm' : 'bg-slate-800 text-slate-400'}`}>
                    <Film className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Choose from Library</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Pick from curated relaxing &amp; lofi video loops</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setVideoSourceMode('upload')}
                  className={`p-4 rounded-2xl border text-left flex items-start space-x-3 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
                    videoSourceMode === 'upload'
                      ? 'bg-red-950/30 border-red-500 text-white shadow-md shadow-red-950/40 ring-1 ring-red-500/30'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl ${videoSourceMode === 'upload' ? 'bg-red-600 text-white shadow-sm' : 'bg-slate-800 text-slate-400'}`}>
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Upload Video</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Use your own MP4 video file from your computer</p>
                  </div>
                </button>
              </div>

              {/* Mode A: Curated Library */}
              {videoSourceMode === 'library' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Click a video clip to select it:</span>
                    <span>{CURATED_LIBRARY.length + userUploads.length} clips available</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[280px] overflow-y-auto pr-1">
                    {/* Curated list */}
                    {CURATED_LIBRARY.map((item) => {
                      const isSelected = selectedVideoUrl === item.url;
                      return (
                        <div
                          key={item.url}
                          onClick={() => {
                            setSelectedVideoUrl(item.url);
                            setSelectedVideoTitle(item.title);
                            if (!titleTouched || !streamTitle.trim()) {
                              setStreamTitle(item.title);
                            }
                            if (item.category.includes('Music')) setCategory('Music');
                            else if (item.category.includes('Gaming')) setCategory('Gaming');
                            else if (item.category.includes('Zen') || item.category.includes('Nature')) setCategory('Travel & Events');
                            else if (item.category.includes('Study')) setCategory('Education');
                          }}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'bg-red-950/40 border-red-500 ring-2 ring-red-500/40 shadow-md'
                              : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="relative h-24 w-full rounded-xl overflow-hidden mb-2.5 bg-slate-900 flex items-center justify-center">
                            {item.thumbnail && item.thumbnail.trim() ? (
                              <img
                                src={item.thumbnail.trim()}
                                alt={item.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Video className="w-8 h-8 text-slate-600" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end p-2 justify-between">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-white">
                                {item.duration}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/90 text-white font-medium">
                                {item.category}
                              </span>
                            </div>
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-white line-clamp-1">{item.title}</h5>
                            <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{item.description}</p>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                            <span className="text-[11px] text-slate-400">Continuous 24/7 Loop</span>
                            {isSelected ? (
                              <span className="flex items-center space-x-1 text-[11px] font-bold text-red-400">
                                <Check className="w-3.5 h-3.5" />
                                <span>Selected</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500">Click to Select</span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Previously uploaded clips */}
                    {userUploads.map((item) => {
                      const isSelected = selectedVideoUrl === item.url;
                      return (
                        <div
                          key={item.url}
                          onClick={() => {
                            setSelectedVideoUrl(item.url);
                            const clean = item.fileName || 'Uploaded Video';
                            setSelectedVideoTitle(clean);
                            if (!titleTouched || !streamTitle.trim()) {
                              setStreamTitle(clean);
                            }
                          }}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'bg-red-950/40 border-red-500 ring-2 ring-red-500/40'
                              : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="h-24 w-full rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-2.5">
                            <Video className="w-8 h-8 text-emerald-400" />
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-white line-clamp-1">{item.fileName}</h5>
                            <p className="text-[11px] text-slate-400 mt-0.5">Your Uploaded Clip &middot; {item.fileSizeMb} MB</p>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-800 flex justify-end">
                            {isSelected ? (
                              <span className="text-[11px] font-bold text-red-400 flex items-center space-x-1">
                                <Check className="w-3.5 h-3.5" />
                                <span>Selected</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500">Select</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Mode B: Upload Local File */}
              {videoSourceMode === 'upload' && (
                <div className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/x-matroska"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                  />

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleFileUpload(e.dataTransfer.files[0]);
                      }
                    }}
                    className="border-2 border-dashed border-slate-700 hover:border-red-500 bg-slate-950 rounded-3xl p-8 text-center cursor-pointer transition-colors group space-y-3"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-red-600/10 text-red-500 border border-red-500/20 mx-auto flex items-center justify-center group-hover:scale-105 transition-transform">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Click or drag a video file here</h4>
                      <p className="text-xs text-slate-400 mt-1">Supports MP4, MOV, or MKV video files</p>
                    </div>
                    <button
                      type="button"
                      className="px-5 py-2 rounded-xl bg-slate-800 group-hover:bg-red-600 text-white text-xs font-semibold transition-colors"
                    >
                      Browse Files
                    </button>
                  </div>

                  {/* Progress bar */}
                  {isUploading && (
                    <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                      <div className="flex justify-between text-xs font-medium text-slate-300">
                        <span className="flex items-center space-x-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
                          <span>Uploading your video...</span>
                        </span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-red-500 h-full transition-all duration-300"
                          style={{ width: `${uploadProgress || 10}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {uploadError && (
                    <p className="text-xs text-red-400 bg-red-950/60 p-3 rounded-xl border border-red-800">
                      {uploadError}
                    </p>
                  )}
                </div>
              )}

              {/* Selected Video Confirmation Preview */}
              {selectedVideoUrl && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider block">
                        Selected Video
                      </span>
                      <h4 className="text-sm font-bold text-white line-clamp-1">{selectedVideoTitle}</h4>
                    </div>
                  </div>

                  {/* Video Player Preview Trigger */}
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setIsInlinePreviewOpen((prev) => !prev)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer flex items-center space-x-1.5 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>{isInlinePreviewOpen ? 'Hide Preview' : 'Preview Clip'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Inline video player element (only rendered when preview open and selectedVideoUrl exists) */}
              {isInlinePreviewOpen && Boolean(selectedVideoUrl?.trim()) && (
                <div className="p-3 rounded-2xl bg-black border border-slate-800">
                  <video
                    src={selectedVideoUrl.trim()}
                    controls
                    loop
                    className="w-full max-h-48 rounded-xl object-contain"
                  />
                </div>
              )}
            </div>
          )}

          {/* ================================================================ */}
          {/* STEP 2: CONNECT DESTINATION */}
          {/* ================================================================ */}
          {step === 2 && (
            <div className="space-y-6">
              {/* Platform Choice Buttons */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 block">
                  Select Live Streaming Platform:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handlePlatformSelect('youtube')}
                    className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
                      platform === 'youtube'
                        ? 'bg-red-600 text-white border-red-500 shadow-md shadow-red-950/60 hover:shadow-lg hover:shadow-red-500/25 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <Radio className="w-5 h-5 mb-1 text-white" />
                    <span className="text-xs">YouTube Live</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePlatformSelect('custom')}
                    className={`p-3.5 rounded-2xl border flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
                      platform === 'custom'
                        ? 'bg-purple-600 text-white border-purple-500 shadow-md shadow-purple-950/60 hover:shadow-lg hover:shadow-purple-500/25 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <Radio className="w-5 h-5 mb-1 text-white" />
                    <span className="text-xs">Custom RTMP</span>
                  </button>
                </div>
              </div>

              {/* Destination URL */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300">
                    Stream Destination URL
                  </label>
                  <span className="text-[11px] text-slate-400">Pre-filled for {platform === 'youtube' ? 'YouTube' : 'Custom'}</span>
                </div>
                <input
                  type="text"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  placeholder="rtmp://..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-red-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Stream Key (Masked by default) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                    <span>Secret Stream Key</span>
                    <span className="text-red-400">*</span>
                  </label>
                  <span className="text-[11px] text-slate-400">Keep this private</span>
                </div>

                <div className="relative">
                  <input
                    type={isKeyVisible ? 'text' : 'password'}
                    value={streamKey}
                    onChange={(e) => {
                      setStreamKey(e.target.value);
                      setConnectionTestStatus(null);
                    }}
                    placeholder="Paste your stream key here"
                    className="w-full pl-4 pr-11 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-red-500 focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setIsKeyVisible(!isKeyVisible)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer transition-colors"
                    title={isKeyVisible ? 'Hide Stream Key' : 'Show Stream Key'}
                  >
                    {isKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <p className="text-[11px] text-slate-400 flex items-center space-x-1 pt-1">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>
                    Get your key from{' '}
                    <strong className="text-slate-300">
                      {platform === 'youtube' ? 'YouTube Studio (Live Stream tab)' : 'your streaming provider'}
                    </strong>.
                  </span>
                </p>
              </div>

              {/* Test Connection Button & Status */}
              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="text-xs font-bold text-white">Test Connection (Optional)</h5>
                    <p className="text-[11px] text-slate-400">Safely check your stream URL and key before broadcasting</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTestingConnection}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md flex items-center space-x-1.5"
                  >
                    {isTestingConnection ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                        <span>Checking...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Test Connection</span>
                      </>
                    )}
                  </button>
                </div>

                {connectionTestStatus && (
                  <div
                    className={`p-2.5 rounded-xl text-xs font-medium flex items-center space-x-2 ${
                      connectionTestStatus.success
                        ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
                        : 'bg-red-950/70 border border-red-800 text-red-300'
                    }`}
                  >
                    {connectionTestStatus.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <X className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span>{connectionTestStatus.message}</span>
                  </div>
                )}
              </div>

              {/* ================================================================ */}
              {/* Multi-Platform Multi-Casting (Restreaming Engine)               */}
              {/* Pro: 2 channels | Business: 4 channels | Free/Basic: 1 channel   */}
              {/* ================================================================ */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <Layers className="w-4 h-4 text-red-500" />
                    <h5 className="text-xs font-extrabold text-white tracking-tight">
                      Multi-Platform Multi-Casting (Restreaming)
                    </h5>
                  </div>

                  {maxAllowedDestinations > 1 ? (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 border border-purple-800/60 font-bold self-start sm:self-auto">
                      {currentUser?.subscription_tier?.toUpperCase()} Tier: {1 + secondaryDestinations.length}/{maxAllowedDestinations} Destinations
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 self-start sm:self-auto">
                      Single-Channel Tier (1/1)
                    </span>
                  )}
                </div>

                {maxAllowedDestinations > 1 ? (
                  <div className="space-y-3">
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Broadcast simultaneously to YouTube, Twitch, Kick &amp; Custom RTMP from one single video source with zero additional CPU load.
                    </p>

                    {/* Secondary destinations list */}
                    {secondaryDestinations.map((dest, idx) => (
                      <div key={dest.id || idx} className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                            <Tv className="w-3.5 h-3.5 text-purple-400" />
                            <span>Destination #{idx + 2}: {dest.label}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSecondaryDestinations(secondaryDestinations.filter((_, i) => i !== idx));
                            }}
                            className="text-slate-400 hover:text-red-400 text-xs p-1 cursor-pointer transition-colors"
                            title="Remove destination"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">RTMP Server URL</label>
                            <input
                              type="text"
                              value={dest.rtmpServerUrl}
                              onChange={(e) => {
                                const copy = [...secondaryDestinations];
                                copy[idx].rtmpServerUrl = e.target.value;
                                setSecondaryDestinations(copy);
                              }}
                              placeholder="rtmp://..."
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-[11px] focus:outline-none focus:border-red-500"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-0.5">Stream Key</label>
                            <input
                              type="password"
                              value={dest.streamKey}
                              onChange={(e) => {
                                const copy = [...secondaryDestinations];
                                copy[idx].streamKey = e.target.value;
                                setSecondaryDestinations(copy);
                              }}
                              placeholder="Paste key here"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono text-[11px] focus:outline-none focus:border-red-500"
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Quick Add Destination Preset Buttons */}
                    {1 + secondaryDestinations.length < maxAllowedDestinations ? (
                      <div className="pt-1 space-y-1.5">
                        <span className="text-[11px] text-slate-400 block">Add Destination:</span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSecondaryDestinations([
                                ...secondaryDestinations,
                                {
                                  id: `dest-${Date.now()}`,
                                  platform: 'twitch',
                                  label: 'Twitch Live',
                                  rtmpServerUrl: 'rtmp://live.twitch.tv/app',
                                  streamKey: '',
                                  isEnabled: true,
                                },
                              ]);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-purple-950/60 hover:bg-purple-900/60 border border-purple-800/60 text-purple-300 text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>+ Twitch</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSecondaryDestinations([
                                ...secondaryDestinations,
                                {
                                  id: `dest-${Date.now()}`,
                                  platform: 'kick',
                                  label: 'Kick Live',
                                  rtmpServerUrl: 'rtmps://fa723fc1b122.global-contribute.live-video.net:443/app/',
                                  streamKey: '',
                                  isEnabled: true,
                                },
                              ]);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/60 text-emerald-300 text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>+ Kick</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSecondaryDestinations([
                                ...secondaryDestinations,
                                {
                                  id: `dest-${Date.now()}`,
                                  platform: 'custom',
                                  label: 'Custom RTMP',
                                  rtmpServerUrl: '',
                                  streamKey: '',
                                  isEnabled: true,
                                },
                              ]);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>+ Custom</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400">
                        Maximum multi-casting capacity reached ({maxAllowedDestinations}/{maxAllowedDestinations} destinations configured).
                      </div>
                    )}
                  </div>
                ) : (
                  /* Single channel restriction message for Free / Basic */
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Multi-Platform Multi-Casting is exclusive to <strong>Pro Plan (2 channels)</strong> and <strong>Business Plan (4 channels)</strong>. Free and Basic tiers broadcast to 1 destination at a time.
                    </p>
                    <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-800/30 flex items-center justify-between text-xs text-amber-300">
                      <span>Restream to YouTube + Twitch + Kick + Custom RTMP</span>
                      <span className="font-bold underline text-[11px]">Pro &amp; Business Only</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* STEP 3: REVIEW & GO LIVE */}
          {/* ================================================================ */}
          {step === 3 && (
            <div className="space-y-5">
              {/* 1. Required Stream Title Field */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center space-x-1">
                    <span>Stream Title</span>
                    <span className="text-red-400 font-bold">*</span>
                  </label>
                  <span
                    className={`text-[11px] font-mono ${
                      streamTitle.length >= 95
                        ? 'text-red-400 font-bold'
                        : streamTitle.length >= 80
                        ? 'text-amber-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {streamTitle.length}/100
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={100}
                  value={streamTitle}
                  onChange={(e) => {
                    setStreamTitle(e.target.value);
                    setTitleTouched(true);
                    if (submitError) setSubmitError(null);
                  }}
                  onBlur={() => setTitleTouched(true)}
                  placeholder="e.g. 24/7 Lofi Radio Chill Station"
                  className={`w-full px-4 py-3 rounded-xl bg-slate-950 border text-white text-xs focus:outline-none transition-colors ${
                    titleTouched && !streamTitle.trim()
                      ? 'border-red-500 focus:border-red-500 ring-1 ring-red-500/40'
                      : 'border-slate-800 focus:border-red-500'
                  }`}
                />
                {titleTouched && !streamTitle.trim() ? (
                  <p className="text-[11px] text-red-400 flex items-center space-x-1 pt-0.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Stream title is required. Please enter a title (up to 100 characters).</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    Pre-filled with your video name &mdash; edit anytime to give your broadcast a custom title.
                  </p>
                )}
              </div>

              {/* 2. Optional Description Multiline Text Area */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                    <span>Description</span>
                    <span className="text-[10px] font-normal text-slate-400">(Optional)</span>
                  </label>
                  <span
                    className={`text-[11px] font-mono ${
                      streamDescription.length >= 480
                        ? 'text-red-400 font-bold'
                        : streamDescription.length >= 400
                        ? 'text-amber-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {streamDescription.length}/500
                  </span>
                </div>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={streamDescription}
                  onChange={(e) => setStreamDescription(e.target.value)}
                  placeholder="Add a friendly description, video credits, social links, or schedule notes for your broadcast..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none transition-colors resize-none placeholder:text-slate-500 leading-relaxed"
                />
                <p className="text-[11px] text-slate-400">
                  Optional notes displayed on your broadcast card. Up to 500 characters.
                </p>

                {currentUser?.subscription_tier === 'free' || currentUser?.has_watermark ? (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span>Free Plan: Standard stream footer will be appended. Upgrade to a paid tier for watermark-free broadcasts.</span>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span>{currentUser?.subscription_tier?.toUpperCase() || 'PAID'} Plan: Clean broadcast &middot; No watermarks or promotional footers.</span>
                  </div>
                )}
              </div>

              {/* 3. Stream Category Dropdown */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                    <Tag className="w-4 h-4 text-red-500" />
                    <span>Stream Category</span>
                    <span className="text-red-400 font-bold">*</span>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    YouTube Live Taxonomy
                  </span>
                </div>
                <div className="relative">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-3 pr-10 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none transition-colors appearance-none cursor-pointer"
                  >
                    {YOUTUBE_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id} className="bg-slate-900 text-white py-1.5">
                        {cat.iconEmoji} {cat.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Select the category that best matches your broadcast for YouTube search algorithms and feed recommendations.
                </p>
              </div>

              {/* Review Summary Card */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Summary
                </h4>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Video Clip</span>
                    <span className="text-white font-bold truncate block mt-0.5">{selectedVideoTitle}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Destination(s)</span>
                    <span className="text-white font-bold block mt-0.5 truncate">
                      {platform === 'youtube' ? 'YouTube Live' : 'Custom RTMP'}
                      {secondaryDestinations.length > 0 && ` + ${secondaryDestinations.length} multi-cast`}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Orientation</span>
                    <span className="text-white font-bold block mt-0.5 flex items-center space-x-1.5">
                      {orientation === 'vertical' ? (
                        <>
                          <Smartphone className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span className="text-rose-300">Vertical (9:16)</span>
                        </>
                      ) : (
                        <>
                          <Monitor className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="text-blue-300">Horizontal (16:9)</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Summary Row 2: Category, Audience, Visibility, Thumbnail */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs pt-1 border-t border-slate-800/80">
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Category</span>
                    <span className="text-white font-bold block mt-0.5 truncate">
                      {YOUTUBE_CATEGORIES.find((c) => c.id === category)?.iconEmoji || '🏷️'} {category}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Audience</span>
                    <span className="text-white font-bold block mt-0.5 truncate">
                      {audience === 'made_for_kids' ? '👶 Made for Kids' : '🧑 Not for Kids'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Visibility</span>
                    <span className="text-white font-bold block mt-0.5 capitalize truncate">
                      {visibility === 'scheduled'
                        ? `📅 Scheduled: ${scheduledFor ? new Date(scheduledFor).toLocaleDateString() : 'Set'}`
                        : visibility === 'public'
                        ? '🌐 Public'
                        : visibility === 'unlisted'
                        ? '🔗 Unlisted'
                        : '🔒 Private'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block uppercase font-medium">Thumbnail</span>
                    <span className="text-white font-bold block mt-0.5 truncate">
                      {thumbnailUrl ? 'Custom Image' : 'Auto Frame'}
                    </span>
                  </div>
                </div>

                {secondaryDestinations.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-purple-950/40 border border-purple-800/40 text-xs flex items-center justify-between">
                    <span className="text-purple-300 font-semibold flex items-center space-x-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Multi-Casting: {1 + secondaryDestinations.length} Platforms simultaneously</span>
                    </span>
                    <span className="text-[10px] text-purple-400 font-mono">
                      {secondaryDestinations.map((d) => d.label).join(', ')}
                    </span>
                  </div>
                )}

                {streamTitle && (
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/60 text-xs">
                    <span className="text-[10px] text-slate-500 uppercase font-medium block">Broadcast Title:</span>
                    <span className="text-slate-200 font-semibold block truncate mt-0.5">{streamTitle}</span>
                  </div>
                )}

                {streamDescription.trim() && (
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/60 text-xs">
                    <span className="text-[10px] text-slate-500 uppercase font-medium block">Description Note:</span>
                    <span className="text-slate-300 block line-clamp-2 mt-0.5">{streamDescription}</span>
                  </div>
                )}
              </div>

              {/* ================================================================ */}
              {/* Stream Orientation / Aspect Ratio Selector (9:16 Shorts vs 16:9 Standard) */}
              {/* ================================================================ */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <span>Stream Orientation &amp; Aspect Ratio</span>
                      <span className="text-red-400 font-bold">*</span>
                    </label>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Choose between standard widescreen layout or vertical format optimized for mobile feeds.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    {orientation === 'vertical' ? '1080 × 1920' : '1920 × 1080'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Horizontal 16:9 Option */}
                  <button
                    type="button"
                    onClick={() => setOrientation('horizontal')}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] flex items-start space-x-3.5 ${
                      orientation === 'horizontal'
                        ? 'bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-950/50 hover:shadow-blue-500/20'
                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div
                      className={`p-2.5 rounded-xl border shrink-0 ${
                        orientation === 'horizontal'
                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      <Monitor className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Horizontal (16:9)</span>
                        {orientation === 'horizontal' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-300 block font-medium mt-0.5">
                        Standard Live Stream
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                        Full HD 1920x1080 widescreen format. Ideal for YouTube Live, Twitch, and desktop viewers.
                      </p>
                    </div>
                  </button>

                  {/* Vertical 9:16 Option */}
                  <button
                    type="button"
                    onClick={() => setOrientation('vertical')}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] flex items-start space-x-3.5 ${
                      orientation === 'vertical'
                        ? 'bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/40 shadow-lg shadow-rose-950/50 hover:shadow-rose-500/20'
                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div
                      className={`p-2.5 rounded-xl border shrink-0 ${
                        orientation === 'vertical'
                          ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Vertical (9:16)</span>
                        {orientation === 'vertical' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-300 block font-medium mt-0.5">
                        Shorts &amp; Reels Live Style
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                        Portrait 1080x1920 format. Auto-scaled &amp; padded for YouTube Shorts Live, TikTok, and Instagram feeds.
                      </p>
                    </div>
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>FFmpeg worker automatically applies hardware-accelerated scaling &amp; aspect-ratio preservation</span>
                  </span>
                  <span className="font-mono text-slate-400">
                    {orientation === 'vertical' ? 'scale=1080:1920 (pad)' : 'scale=1920:1080 (copy)'}
                  </span>
                </div>
              </div>

              {/* ================================================================ */}
              {/* Custom Thumbnail Configuration (Upload or Image URL)            */}
              {/* ================================================================ */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <ImageIcon className="w-4 h-4 text-red-500" />
                      <span>Custom Broadcast Thumbnail</span>
                      <span className="text-[10px] font-normal text-slate-400">(Optional)</span>
                    </label>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Upload or specify a custom high-resolution cover image to attract viewers on live feeds.
                    </p>
                  </div>
                  <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() => setThumbnailMode('url')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer ${
                        thumbnailMode === 'url' ? 'bg-red-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Image URL
                    </button>
                    <button
                      type="button"
                      onClick={() => setThumbnailMode('upload')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer ${
                        thumbnailMode === 'upload' ? 'bg-red-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Upload File
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {thumbnailMode === 'url' ? (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <input
                          type="url"
                          value={thumbnailUrl}
                          onChange={(e) => {
                            setThumbnailUrl(e.target.value);
                            setThumbUploadError(null);
                          }}
                          placeholder="https://example.com/stream-thumbnail.jpg"
                          className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none transition-colors"
                        />
                        {thumbnailUrl && (
                          <button
                            type="button"
                            onClick={() => setThumbnailUrl('')}
                            className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-white"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Paste a public HTTPS link to a 1280×720 (16:9) or 1080×1920 (9:16) image.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        ref={thumbInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleThumbnailUpload(e.target.files[0]);
                          }
                        }}
                      />
                      <div
                        onClick={() => thumbInputRef.current?.click()}
                        className="p-5 border-2 border-dashed border-slate-800 hover:border-red-500 rounded-2xl bg-slate-900/50 flex flex-col items-center justify-center cursor-pointer transition-colors group"
                      >
                        {isUploadingThumb ? (
                          <div className="flex items-center space-x-2 text-xs text-slate-300">
                            <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                            <span>Uploading thumbnail image...</span>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-slate-400 group-hover:text-red-500 mb-1 transition-colors" />
                            <span className="text-xs font-semibold text-slate-200">
                              Click to upload custom thumbnail
                            </span>
                            <span className="text-[10px] text-slate-500 mt-0.5">
                              JPG, PNG, or WebP &middot; Recommended 1920×1080 or 1080×1920
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {thumbUploadError && (
                    <p className="text-xs text-red-400 bg-red-950/60 p-2.5 rounded-xl border border-red-800">
                      {thumbUploadError}
                    </p>
                  )}

                  {/* Thumbnail Preview if provided */}
                  {Boolean(thumbnailUrl && thumbnailUrl.trim()) && (
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center space-x-3">
                      <div className="w-20 h-14 rounded-lg bg-black overflow-hidden border border-slate-700 shrink-0">
                        <img
                          src={thumbnailUrl.trim()}
                          alt="Thumbnail preview"
                          className="w-full h-full object-cover"
                          onError={() => setThumbUploadError('Image failed to load. Please verify the URL.')}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-bold text-emerald-400 flex items-center space-x-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Custom Thumbnail Set</span>
                        </span>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{thumbnailUrl}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setThumbnailUrl('')}
                        className="text-xs text-slate-400 hover:text-red-400 p-1.5 cursor-pointer"
                        title="Remove custom thumbnail"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ================================================================ */}
              {/* Audience Selection (COPPA Compliance)                           */}
              {/* ================================================================ */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div>
                  <label className="text-xs font-bold text-white flex items-center space-x-1.5">
                    <UserCheck className="w-4 h-4 text-red-500" />
                    <span>Audience Targeting &amp; COPPA Guidelines</span>
                    <span className="text-red-400 font-bold">*</span>
                  </label>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Regardless of your location, you are legally required to comply with the Children&rsquo;s Online Privacy Protection Act (COPPA).
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Not Made for Kids Option */}
                  <label
                    onClick={() => setAudience('not_for_kids')}
                    className={`p-3.5 rounded-xl border flex items-start space-x-3 cursor-pointer transition-all ${
                      audience === 'not_for_kids'
                        ? 'bg-slate-900 border-red-500 ring-2 ring-red-500/30'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="audience"
                      value="not_for_kids"
                      checked={audience === 'not_for_kids'}
                      onChange={() => setAudience('not_for_kids')}
                      className="mt-0.5 text-red-600 focus:ring-red-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-white block">
                        No, it&rsquo;s not made for kids
                      </span>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Features like live chat, super chats, and personalized alerts remain fully enabled.
                      </p>
                    </div>
                  </label>

                  {/* Made for Kids Option */}
                  <label
                    onClick={() => setAudience('made_for_kids')}
                    className={`p-3.5 rounded-xl border flex items-start space-x-3 cursor-pointer transition-all ${
                      audience === 'made_for_kids'
                        ? 'bg-slate-900 border-red-500 ring-2 ring-red-500/30'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="audience"
                      value="made_for_kids"
                      checked={audience === 'made_for_kids'}
                      onChange={() => setAudience('made_for_kids')}
                      className="mt-0.5 text-red-600 focus:ring-red-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-white block flex items-center space-x-1">
                        <span>Yes, it&rsquo;s made for kids</span>
                      </span>
                      <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Tailored for younger children. Live chat and personalized ads are disabled by YouTube.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* ================================================================ */}
              {/* Stream Visibility & Scheduling Controls                         */}
              {/* ================================================================ */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
                <div>
                  <label className="text-xs font-bold text-white flex items-center space-x-1.5">
                    <Globe className="w-4 h-4 text-red-500" />
                    <span>Stream Visibility &amp; Scheduler</span>
                    <span className="text-red-400 font-bold">*</span>
                  </label>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Control who can see your broadcast or schedule it to go live at an exact calendar time.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { id: 'public', label: 'Public', icon: Globe, sub: 'Anyone can search & watch' },
                    { id: 'unlisted', label: 'Unlisted', icon: LinkIcon, sub: 'Anyone with the link' },
                    { id: 'private', label: 'Private', icon: Lock, sub: 'Only you can view' },
                    { id: 'scheduled', label: 'Scheduled', icon: Calendar, sub: 'Set future date/time' },
                  ].map((v) => {
                    const IconComp = v.icon;
                    const isSelected = visibility === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVisibility(v.id as StreamVisibility)}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] flex flex-col justify-between ${
                          isSelected
                            ? 'bg-red-950/40 border-red-500 ring-2 ring-red-500/40 text-white shadow-md shadow-red-950/40'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <IconComp className={`w-4 h-4 ${isSelected ? 'text-red-400' : 'text-slate-400'}`} />
                          {isSelected && <span className="w-2 h-2 rounded-full bg-red-500" />}
                        </div>
                        <div>
                          <span className="text-xs font-bold block">{v.label}</span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">{v.sub}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Date & Time Picker when Scheduled is selected */}
                {visibility === 'scheduled' && (
                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-white flex items-center space-x-1.5">
                        <Clock className="w-3.5 h-3.5 text-red-400" />
                        <span>Scheduled Broadcast Date &amp; Time</span>
                      </label>
                      <span className="text-[10px] text-slate-400">Local Time</span>
                    </div>

                    <input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-red-500 focus:outline-none transition-colors"
                    />
                    <p className="text-[11px] text-slate-400">
                      Your 24/7 stream container will prepare the feed and display a countdown on your destination channel.
                    </p>
                  </div>
                )}
              </div>

              {/* Continuous Loop Toggle (Plain English) */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div className="flex items-start space-x-3">
                  <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
                    <Repeat className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-white">Continuous 24/7 Playback</h5>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      When the video reaches the end, it will automatically loop back to the start so your stream stays live 24/7.
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer ml-3">
                  <input
                    type="checkbox"
                    checked={isLooping}
                    onChange={(e) => setIsLooping(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                </label>
              </div>

              {/* Stream Quality Selector */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 block">
                  Stream Quality:
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { id: 'original', label: 'Original Quality', sub: 'Recommended' },
                    { id: '1080p', label: '1080p Full HD', sub: 'Standard' },
                    { id: '720p', label: '720p HD', sub: 'Low bandwidth' },
                  ].map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setQualityOption(q.id as any)}
                      className={`p-3 rounded-xl border text-center cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
                        qualityOption === q.id
                          ? 'bg-red-600 text-white border-red-500 font-semibold shadow-md shadow-red-950/50'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      <span className="text-xs block font-bold">{q.label}</span>
                      <span className="text-[10px] opacity-75 block mt-0.5">{q.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {submitError && (
                <div className="p-3 rounded-xl bg-red-950/80 border border-red-800 text-red-300 text-xs flex items-center justify-between">
                  <span>{submitError}</span>
                  <button onClick={() => setSubmitError(null)} className="text-red-400 ml-2 font-bold">✕</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-5 sm:p-6 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3">
          {/* Back Button */}
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((step - 1) as any)}
              className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-semibold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
            >
              Cancel
            </button>
          )}

          {/* Next / Submit Actions */}
          <div className="flex items-center space-x-2.5">
            {step < 3 ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 1 && !selectedVideoUrl) {
                    setUploadError('Please select or upload a video clip to proceed.');
                    return;
                  }
                  if (step === 2 && !streamKey.trim()) {
                    setConnectionTestStatus({
                      tested: true,
                      success: false,
                      message: 'Please enter your stream key before continuing to Step 3.',
                    });
                    return;
                  }
                  setStep((step + 1) as any);
                }}
                disabled={(step === 1 && !selectedVideoUrl) || (step === 2 && !streamKey.trim())}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-red-950/60 hover:shadow-lg hover:shadow-red-500/25"
              >
                <span>{step === 1 ? 'Next: Connect Destination' : 'Next: Review & Go Live'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleSubmit(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
                >
                  Save as Ready
                </button>

                <button
                  type="button"
                  onClick={() => handleSubmit(true)}
                  disabled={isSubmitting}
                  className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-extrabold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-red-950/80 hover:shadow-xl hover:shadow-red-500/30 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Setting up live stream...</span>
                    </>
                  ) : (
                    <>
                      <Radio className="w-3.5 h-3.5 animate-pulse" />
                      <span>Start Live Stream</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
