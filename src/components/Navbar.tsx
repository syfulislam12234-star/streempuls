import React from 'react';
import {
  Radio,
  Plus,
  Zap,
  Lock,
  User,
  ShieldCheck,
  CreditCard,
  LogOut,
  ChevronDown,
  Bell,
  BookOpen,
} from 'lucide-react';
import { UserProfile } from '../services/apiClient';
import logoImg from '../assets/images/streampulse_logo_1791782499836.jpg';

interface NavbarProps {
  currentUser: UserProfile | null;
  activeStreamsCount: number;
  unreadNotificationsCount?: number;
  onOpenCreateModal: () => void;
  onOpenPlanModal: () => void;
  onOpenAuthModal: () => void;
  onOpenTutorials?: () => void;
  onOpenNotificationsModal?: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeStreamsCount,
  unreadNotificationsCount = 0,
  onOpenCreateModal,
  onOpenPlanModal,
  onOpenAuthModal,
  onOpenTutorials,
  onOpenNotificationsModal,
  onLogout,
}) => {
  const isPlanActive = currentUser?.subscription_status === 'active';

  return (
    <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo & Friendly Title */}
          <div className="flex items-center space-x-2.5">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-red-500/40 shadow-sm">
              <img src={logoImg} alt="StreamPulse Logo" className="w-full h-full object-contain p-0.5" />
              {activeStreamsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 z-10">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-base tracking-tight text-white">
                  StreamPulse
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-950/80 text-red-300 border border-red-800/40">
                  Live Studio
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Continuous 24/7 automated broadcasting
              </p>
            </div>
          </div>

          {/* Center / Right: Subscription Tier Badge & Limits */}
          <div className="flex items-center space-x-2.5">
            {/* Zero-Admin Autonomous Engine Status Indicator */}
            <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold shadow-sm shadow-emerald-950/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-400">Autonomous Engine:</span>
              <span className="text-emerald-400 font-bold">100% Active</span>
            </div>
            {currentUser && (
              <button
                onClick={onOpenPlanModal}
                className={`hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg cursor-pointer ${
                  isPlanActive
                    ? currentUser.subscription_tier === 'business'
                      ? 'bg-purple-950/40 border-purple-800/60 text-purple-300 hover:bg-purple-900/40 hover:shadow-purple-500/10'
                      : currentUser.subscription_tier === 'pro'
                      ? 'bg-red-950/40 border-red-800/60 text-red-300 hover:bg-red-900/40 hover:shadow-red-500/10'
                      : currentUser.subscription_tier === 'basic'
                      ? 'bg-blue-950/40 border-blue-800/60 text-blue-300 hover:bg-blue-900/40 hover:shadow-blue-500/10'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                    : 'bg-amber-950/40 border-amber-800/60 text-amber-300 hover:shadow-amber-500/10 animate-pulse'
                }`}
                title="Click to view or change subscription plan"
              >
                {isPlanActive ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>
                  {isPlanActive
                    ? `${currentUser.subscription_tier.toUpperCase()} Plan (${currentUser.channel_limit} Ch / ${currentUser.video_limit} Vid)`
                    : 'Plan: Unpaid / Locked'}
                </span>
                <span className="text-[10px] text-slate-400 underline font-normal">
                  Change
                </span>
              </button>
            )}

            {/* Live Status Indicator */}
            {isPlanActive && (
              <div
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-300 ease-in-out ${
                  activeStreamsCount > 0
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300 shadow-sm shadow-emerald-950/30'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    activeStreamsCount > 0
                      ? 'bg-emerald-400 animate-pulse'
                      : 'bg-slate-500'
                  }`}
                />
                <span className="hidden sm:inline">
                  {activeStreamsCount > 0
                    ? `${activeStreamsCount} Live`
                    : 'Ready'}
                </span>
              </div>
            )}

            {/* Create Live Stream Button (Only active when plan is active) */}
            {isPlanActive && (
              <button
                onClick={onOpenCreateModal}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold shadow-md shadow-red-950/60 hover:shadow-lg hover:shadow-red-900/80 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Go Live</span>
              </button>
            )}

            {/* Tutorials & Guide Videos Button */}
            {onOpenTutorials && (
              <button
                onClick={onOpenTutorials}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-red-500/10"
                title="Watch Video Guides & 24/7 Setup Tutorials"
              >
                <BookOpen className="w-3.5 h-3.5 text-red-400" />
                <span className="hidden md:inline">Tutorials</span>
              </button>
            )}

            {/* In-App Notifications & Expiry Alerts Button */}
            {onOpenNotificationsModal && (
              <button
                onClick={onOpenNotificationsModal}
                className="relative p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white cursor-pointer transition-all duration-300 ease-in-out hover:scale-105 active:scale-[0.98] hover:shadow-lg hover:shadow-slate-500/10"
                title="In-App Notifications & Expiry Alerts"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>
            )}



            {/* Account Switcher / User Button */}
            <button
              onClick={onOpenAuthModal}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-slate-500/10"
              title="Switch user account or register test user"
            >
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span className="max-w-[100px] truncate hidden sm:inline">
                {currentUser?.email || 'Account'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
