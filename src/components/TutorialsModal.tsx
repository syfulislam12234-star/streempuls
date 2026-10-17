import React, { useState, useEffect } from 'react';
import {
  Play,
  X,
  Plus,
  Pencil,
  Trash2,
  Video,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Sparkles,
  BookOpen,
  Filter,
  Tv,
  Radio,
  Eye,
} from 'lucide-react';
import { apiClient, TutorialVideo, UserProfile } from '../services/apiClient';

interface TutorialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
}

type TutorialCategory = 'all' | 'getting_started' | 'youtube_setup' | 'stream_keys' | 'troubleshooting' | 'pro_tips';

export const TutorialsModal: React.FC<TutorialsModalProps> = ({ isOpen, onClose, currentUser }) => {
  const [tutorials, setTutorials] = useState<TutorialVideo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<TutorialCategory>('all');
  const [activeVideo, setActiveVideo] = useState<TutorialVideo | null>(null);

  // Admin Management State
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    video_url: '',
    category: 'getting_started' as TutorialVideo['category'],
    duration_minutes: 5,
    thumbnail_url: '',
  });
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isAdmin = currentUser?.role === 'admin';

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
      setFeedbackMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const categoriesList: { id: TutorialCategory; label: string }[] = [
    { id: 'all', label: 'All Guides' },
    { id: 'getting_started', label: 'Getting Started' },
    { id: 'youtube_setup', label: 'YouTube Studio' },
    { id: 'stream_keys', label: 'Stream Keys' },
    { id: 'troubleshooting', label: 'Troubleshooting' },
    { id: 'pro_tips', label: 'Pro Tips (0% CPU)' },
  ];

  const filteredTutorials = tutorials.filter((t) => {
    if (selectedCategory === 'all') return true;
    return t.category === selectedCategory;
  });

  const handleOpenAddForm = () => {
    setEditingId(null);
    setFormData({
      title: '',
      description: '',
      video_url: '',
      category: 'getting_started',
      duration_minutes: 5,
      thumbnail_url: '',
    });
    setIsEditing(true);
    setFeedbackMsg(null);
  };

  const handleOpenEditForm = (t: TutorialVideo, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(t.id);
    setFormData({
      title: t.title,
      description: t.description || '',
      video_url: t.video_url,
      category: t.category,
      duration_minutes: t.duration_minutes || 5,
      thumbnail_url: t.thumbnail_url || '',
    });
    setIsEditing(true);
    setFeedbackMsg(null);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAdmin) return;
    if (!window.confirm('Are you sure you want to delete this tutorial video?')) return;

    try {
      await apiClient.deleteTutorial(id, currentUser?.id);
      setFeedbackMsg({ type: 'success', text: 'Tutorial deleted successfully' });
      const updated = tutorials.filter((t) => t.id !== id);
      setTutorials(updated);
      if (activeVideo?.id === id) {
        setActiveVideo(updated[0] || null);
      }
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Failed to delete tutorial' });
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!formData.title.trim() || !formData.video_url.trim()) {
      setFeedbackMsg({ type: 'error', text: 'Title and video URL are required' });
      return;
    }

    setIsSubmitting(true);
    setFeedbackMsg(null);
    try {
      if (editingId) {
        const updated = await apiClient.updateTutorial(editingId, formData, currentUser?.id);
        setTutorials((prev) => prev.map((t) => (t.id === editingId ? updated : t)));
        if (activeVideo?.id === editingId) setActiveVideo(updated);
        setFeedbackMsg({ type: 'success', text: 'Tutorial video updated successfully!' });
      } else {
        const created = await apiClient.createTutorial(formData, currentUser?.id);
        setTutorials((prev) => [created, ...prev]);
        setActiveVideo(created);
        setFeedbackMsg({ type: 'success', text: 'New tutorial video published successfully!' });
      }
      setIsEditing(false);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Failed to save tutorial' });
    } finally {
      setIsSubmitting(false);
    }
  };

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto">
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
                {isAdmin && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800/60 flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3 text-purple-400" />
                    <span>Admin Mode</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Master 24/7 continuous live streaming, YouTube RTMP keys, and direct-copy zero-CPU mode
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {isAdmin && !isEditing && (
              <button
                type="button"
                onClick={handleOpenAddForm}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-purple-950/50 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Add Tutorial</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedbackMsg && (
          <div
            className={`px-6 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-300'
                : 'bg-red-950/60 border-red-800/80 text-red-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              {feedbackMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedbackMsg.text}</span>
            </div>
            <button
              onClick={() => setFeedbackMsg(null)}
              className="text-slate-400 hover:text-white font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Admin Add/Edit Form Overlay */}
        {isEditing && isAdmin ? (
          <div className="p-6 overflow-y-auto max-h-[calc(92vh-80px)] space-y-5 bg-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-white">
                  {editingId ? 'Edit Tutorial Video Link' : 'Add New Tutorial Video (Admin Only)'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Video Headline / Title *
                </label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. How to Connect YouTube Live RTMP Keys and Stream Continuously"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none placeholder:text-slate-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    YouTube Watch or Embed URL *
                  </label>
                  <input
                    type="url"
                    required
                    value={formData.video_url}
                    onChange={(e) => setFormData({ ...formData, video_url: e.target.value })}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none placeholder:text-slate-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Accepts standard watch links, youtu.be shortlinks, or embed links.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Category Topic
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none"
                  >
                    <option value="getting_started">Getting Started</option>
                    <option value="youtube_setup">YouTube Setup</option>
                    <option value="stream_keys">Stream Keys</option>
                    <option value="troubleshooting">Troubleshooting</option>
                    <option value="pro_tips">Pro Tips (0% CPU)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={formData.duration_minutes}
                    onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) || 5 })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Custom Thumbnail Image URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={formData.thumbnail_url}
                    onChange={(e) => setFormData({ ...formData, thumbnail_url: e.target.value })}
                    placeholder="Leave empty to auto-extract YouTube thumbnail"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Description &amp; Key Highlights
                </label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Outline what steps are covered, timestamps, and helpful tips..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none placeholder:text-slate-500 resize-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-purple-950/60 flex items-center space-x-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>{editingId ? 'Update Tutorial' : 'Publish Tutorial'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Main Interactive Video Player & Guides Gallery */
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

                {/* Active Video Metadata & Quick Admin Controls */}
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

                    {isAdmin && (
                      <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={(e) => handleOpenEditForm(activeVideo, e)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-400 hover:text-purple-300 cursor-pointer transition-all duration-300 ease-in-out hover:scale-105"
                          title="Edit tutorial"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(activeVideo.id, e)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 cursor-pointer transition-all duration-300 ease-in-out hover:scale-105"
                          title="Delete tutorial"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
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
                                // Fallback image if custom url fails
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

                          {isAdmin && (
                            <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => handleOpenEditForm(tut, e)}
                                className="p-1 rounded text-purple-400 hover:text-purple-300 hover:bg-slate-800 transition-all duration-300 ease-in-out hover:scale-110"
                                title="Edit"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDelete(tut.id, e)}
                                className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-all duration-300 ease-in-out hover:scale-110"
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
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
                  <span className="font-bold text-slate-200 block">2. Paste Stream Key</span>
                  <p className="text-slate-400">Get your RTMP key from YouTube Live Studio or Custom RTMP provider.</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-1">
                  <span className="font-bold text-slate-200 block">3. Click Start Live</span>
                  <p className="text-slate-400">Our isolated cloud workers broadcast 24/7 with direct-copy zero CPU lag.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div className="flex items-center space-x-2">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>24/7 Continuous Live Cloud Infrastructure</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
          >
            Close Guides
          </button>
        </div>
      </div>
    </div>
  );
};
