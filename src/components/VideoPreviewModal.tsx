import React, { useEffect, useState } from 'react';
import { X, Play } from 'lucide-react';
import { apiClient } from '../services/apiClient';

interface VideoPreviewModalProps {
  title: string;
  videoUrl: string;
  onClose: () => void;
}

export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({
  title,
  videoUrl,
  onClose,
}) => {
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setPlaybackUrl('');
    setPreviewError(null);
    apiClient.getR2PreviewUrl(videoUrl.trim())
      .then((previewUrl) => {
        if (isCurrent) setPlaybackUrl(previewUrl || videoUrl.trim());
      })
      .catch((error) => {
        if (isCurrent) setPreviewError(error instanceof Error ? error.message : 'Sign in again to preview this private video.');
      });

    return () => {
      isCurrent = false;
    };
  }, [videoUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Friendly Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center">
              <Play className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
              <p className="text-xs text-slate-400">Video Preview</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-all duration-300 ease-in-out hover:scale-105 active:scale-95"
            aria-label="Close Preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Player */}
        <div className="p-4 sm:p-6 bg-black flex items-center justify-center min-h-[220px]">
          {previewError ? (
            <p role="alert" className="text-sm text-amber-300 text-center py-12">{previewError}</p>
          ) : playbackUrl ? (
            <video
              src={playbackUrl}
              controls
              autoPlay
              loop
              className="max-h-[380px] w-full rounded-xl object-contain bg-slate-950 shadow-inner"
            />
          ) : (
            <div className="text-slate-500 text-xs text-center py-12">
              No video preview available.
            </div>
          )}
        </div>

        {/* Friendly Footer */}
        <div className="p-4 sm:p-5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            This video will play continuously on your live broadcast.
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
