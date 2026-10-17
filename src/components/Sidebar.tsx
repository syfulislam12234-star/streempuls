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
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Bell,
  BookOpen,
  Settings,
  Activity,
  Layers,
  ExternalLink,
  Mail,
} from 'lucide-react';
import { UserProfile } from '../services/apiClient';
import logoImg from '../assets/images/streampulse_logo_1791782499836.jpg';

export interface SidebarProps {
  currentUser: UserProfile | null;
  activeStreamsCount: number;
  unreadNotificationsCount?: number;
  currentView: 'studio' | 'admin';
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenMobile: () => void;
  onNavigateStudio: () => void;
  onOpenCreateModal: () => void;
  onOpenPlanModal: () => void;
  onOpenAuthModal: () => void;
  onOpenTutorials?: () => void;
  onOpenNotificationsModal?: () => void;
  onOpenGmail?: () => void;
  onOpenLegal?: (tab?: 'terms' | 'privacy', sectionId?: string) => void;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  activeStreamsCount,
  unreadNotificationsCount = 0,
  currentView,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  onOpenMobile,
  onNavigateStudio,
  onOpenCreateModal,
  onOpenPlanModal,
  onOpenAuthModal,
  onOpenTutorials,
  onOpenNotificationsModal,
  onOpenGmail,
  onOpenLegal,
  onLogout,
}) => {
  const isPlanActive = currentUser?.subscription_status === 'active';

  const navItems = [
    {
      id: 'studio',
      label: 'Live Studio',
      icon: Radio,
      badge: activeStreamsCount > 0 ? `${activeStreamsCount} Live` : undefined,
      badgeColor: 'bg-emerald-950 text-emerald-400 border-emerald-500/30',
      isActive: currentView === 'studio',
      onClick: () => {
        onNavigateStudio();
        onCloseMobile();
      },
    },
    {
      id: 'plans',
      label: 'Plans & Pricing',
      icon: Zap,
      badge: currentUser?.subscription_tier ? currentUser.subscription_tier.toUpperCase() : undefined,
      badgeColor:
        currentUser?.subscription_tier === 'pro'
          ? 'bg-red-950 text-red-400 border-red-500/30'
          : currentUser?.subscription_tier === 'business'
          ? 'bg-purple-950 text-purple-400 border-purple-500/30'
          : 'bg-slate-800 text-slate-300 border-slate-700',
      isActive: false,
      onClick: () => {
        onOpenPlanModal();
        onCloseMobile();
      },
    },
    {
      id: 'gmail',
      label: 'Gmail & Email Alerts',
      icon: Mail,
      badge: 'Google',
      badgeColor: 'bg-red-950 text-red-400 border-red-500/30',
      isActive: false,
      onClick: () => {
        if (onOpenGmail) onOpenGmail();
        onCloseMobile();
      },
    },
    {
      id: 'tutorials',
      label: 'Tutorials & Guides',
      icon: BookOpen,
      isActive: false,
      onClick: () => {
        if (onOpenTutorials) onOpenTutorials();
        onCloseMobile();
      },
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badge: unreadNotificationsCount > 0 ? `${unreadNotificationsCount}` : undefined,
      badgeColor: 'bg-red-600 text-white font-bold',
      isActive: false,
      onClick: () => {
        if (onOpenNotificationsModal) onOpenNotificationsModal();
        onCloseMobile();
      },
    },
    {
      id: 'settings',
      label: 'Account Settings',
      icon: Settings,
      isActive: false,
      onClick: () => {
        onOpenAuthModal();
        onCloseMobile();
      },
    },
  ];

  return (
    <>
      {/* ==================================================================== */}
      {/* MOBILE TOP BAR (Visible on < lg screens) */}
      {/* ==================================================================== */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 z-40 px-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onOpenMobile}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Open Navigation Sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-red-500/40 relative shrink-0">
              <img src={logoImg} alt="StreamPulse" className="w-full h-full object-contain p-0.5" />
              {activeStreamsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-extrabold text-sm tracking-tight text-white">StreamPulse</span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-red-950 text-red-400 border border-red-800/50">
                  Studio
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {isPlanActive && (
            <button
              onClick={onOpenCreateModal}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white text-xs font-bold shadow-md shadow-red-950/60 flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="text-xs">Live</span>
            </button>
          )}

          <button
            onClick={onOpenAuthModal}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
            title="Account"
          >
            <User className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* MOBILE BACKDROP OVERLAY */}
      {/* ==================================================================== */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="lg:hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* ==================================================================== */}
      {/* VERTICAL SIDEBAR (Desktop Fixed & Mobile Drawer) */}
      {/* ==================================================================== */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-slate-950 border-r border-slate-800/80 transition-all duration-300 ease-in-out ${
          /* Mobile slide-in positioning */
          isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        } ${
          /* Desktop width: Collapsed vs Expanded */
          isCollapsed ? 'lg:w-20' : 'lg:w-64'
        } w-72`}
      >
        {/* SIDEBAR HEADER / BRANDING */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800/80 shrink-0">
          <div
            onClick={onNavigateStudio}
            className="flex items-center space-x-3 cursor-pointer group overflow-hidden"
          >
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl overflow-hidden bg-slate-900 border border-red-500/40 shadow-sm shrink-0 transition-transform group-hover:scale-105">
              <img src={logoImg} alt="StreamPulse Logo" className="w-full h-full object-contain p-0.5" />
              {activeStreamsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              )}
            </div>

            {(!isCollapsed || isMobileOpen) && (
              <div className="transition-opacity duration-200 min-w-0">
                <div className="flex items-center space-x-1.5">
                  <span className="font-extrabold text-base tracking-tight text-white group-hover:text-red-400 transition-colors truncate">
                    StreamPulse
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-800/50 uppercase shrink-0">
                    SaaS
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 truncate">
                  24/7 Live Broadcasting
                </p>
              </div>
            )}
          </div>

          {/* Desktop Collapse / Expand Toggle Button */}
          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {/* Mobile Close Button */}
          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* GO LIVE QUICK ACTION BUTTON */}
        <div className="p-3 shrink-0">
          {isPlanActive ? (
            <button
              onClick={() => {
                onOpenCreateModal();
                onCloseMobile();
              }}
              className={`w-full py-2.5 px-3 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs shadow-lg shadow-red-950/60 hover:shadow-red-900/80 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center ${
                isCollapsed && !isMobileOpen ? 'justify-center' : 'justify-center space-x-2'
              }`}
              title="Create New Live Stream"
            >
              <Plus className="w-4 h-4 shrink-0" />
              {(!isCollapsed || isMobileOpen) && <span>Go Live</span>}
            </button>
          ) : (
            <button
              onClick={() => {
                onOpenPlanModal();
                onCloseMobile();
              }}
              className={`w-full py-2.5 px-3 rounded-2xl bg-amber-950/80 hover:bg-amber-900/80 border border-amber-600/40 text-amber-300 font-bold text-xs transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center ${
                isCollapsed && !isMobileOpen ? 'justify-center' : 'justify-center space-x-2'
              }`}
              title="Unlock Studio Plan"
            >
              <Lock className="w-4 h-4 shrink-0 text-amber-400" />
              {(!isCollapsed || isMobileOpen) && <span>Unlock Studio</span>}
            </button>
          )}
        </div>

        {/* MAIN NAVIGATION ITEMS LIST */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 py-1">
            {(!isCollapsed || isMobileOpen) ? 'Navigation' : '•••'}
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`w-full flex items-center rounded-2xl py-2.5 px-3 text-xs font-semibold transition-all duration-200 cursor-pointer group ${
                  isCollapsed && !isMobileOpen ? 'justify-center' : 'justify-between'
                } ${
                  item.isActive
                    ? 'bg-red-600/15 border border-red-500/40 text-red-300 shadow-sm shadow-red-950/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-900/90 border border-transparent hover:border-slate-800'
                }`}
                title={item.label}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      item.isActive ? 'text-red-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  {(!isCollapsed || isMobileOpen) && (
                    <span className="truncate">{item.label}</span>
                  )}
                </div>

                {(!isCollapsed || isMobileOpen) && item.badge && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                      item.badgeColor || 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* SYSTEM TELEMETRY WIDGET (Collapsed vs Expanded) */}
          {(!isCollapsed || isMobileOpen) && (
            <div className="pt-4 pb-2">
              <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 font-medium">Broadcast Engine</span>
                  <span className="flex items-center space-x-1 text-emerald-400 font-bold font-mono text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>ONLINE</span>
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800">
                  <span className="text-slate-400">Active Streams</span>
                  <span className="text-white font-mono font-bold">{activeStreamsCount}</span>
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800">
                  <span className="text-slate-400">Current Plan</span>
                  <button
                    onClick={() => {
                      onOpenPlanModal();
                      onCloseMobile();
                    }}
                    className="text-red-400 font-bold hover:underline cursor-pointer uppercase text-[10px]"
                  >
                    {currentUser?.subscription_tier || 'Free'} &rarr;
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SIDEBAR FOOTER / USER PROFILE & LOGOUT */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 shrink-0 space-y-2">
          {currentUser ? (
            <div
              className={`flex items-center rounded-2xl p-2 bg-slate-900/60 border border-slate-800/80 ${
                isCollapsed && !isMobileOpen ? 'justify-center' : 'justify-between'
              }`}
            >
              <div
                onClick={() => {
                  onOpenAuthModal();
                  onCloseMobile();
                }}
                className="flex items-center space-x-2.5 min-w-0 cursor-pointer group"
                title="Account Settings"
              >
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-600/20 to-rose-600/20 border border-red-500/30 flex items-center justify-center text-red-400 font-bold text-xs shrink-0 group-hover:border-red-500 transition-colors">
                  {currentUser.email ? currentUser.email.charAt(0).toUpperCase() : 'U'}
                </div>
                {(!isCollapsed || isMobileOpen) && (
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white group-hover:text-red-300 transition-colors truncate">
                      {currentUser.full_name || currentUser.email.split('@')[0]}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {currentUser.email}
                    </div>
                  </div>
                )}
              </div>

              {(!isCollapsed || isMobileOpen) && (
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-xl hover:bg-red-950/60 text-slate-400 hover:text-red-400 transition-colors cursor-pointer shrink-0"
                  title="Sign Out / Switch Account"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => {
                onOpenAuthModal();
                onCloseMobile();
              }}
              className={`w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-semibold cursor-pointer flex items-center ${
                isCollapsed && !isMobileOpen ? 'justify-center' : 'justify-center space-x-2'
              }`}
            >
              <User className="w-4 h-4 text-slate-400" />
              {(!isCollapsed || isMobileOpen) && <span>Sign In</span>}
            </button>
          )}

          {/* Legal micro-links */}
          {(!isCollapsed || isMobileOpen) && onOpenLegal && (
            <div className="flex items-center justify-center space-x-2 text-[10px] text-slate-400 pt-1">
              <button
                onClick={() => {
                  onOpenLegal('terms');
                  onCloseMobile();
                }}
                className="hover:text-slate-300 underline cursor-pointer"
              >
                Terms
              </button>
              <span>&bull;</span>
              <button
                onClick={() => {
                  onOpenLegal('privacy');
                  onCloseMobile();
                }}
                className="hover:text-slate-300 underline cursor-pointer"
              >
                Privacy
              </button>
              <span>&bull;</span>
              <button
                onClick={() => {
                  onOpenLegal('terms', 'aup');
                  onCloseMobile();
                }}
                className="hover:text-amber-400 underline cursor-pointer"
              >
                AUP
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
