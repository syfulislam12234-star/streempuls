import React from 'react';
import {
  Radio,
  Plus,
  Zap,
  Lock,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  X,
  Bell,
  BookOpen,
  Settings,
  Mail,
  CreditCard,
} from 'lucide-react';
import { UserProfile } from '../services/apiClient';
import logoImg from '../assets/images/streampulse_logo_1791782499836.jpg';

export interface SidebarProps {
  currentUser: UserProfile | null;
  activeStreamsCount: number;
  unreadNotificationsCount?: number;
  currentView?: 'studio';
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenMobile?: () => void;
  onNavigateStudio: () => void;
  isPlanModalOpen?: boolean;
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
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  onNavigateStudio,
  isPlanModalOpen = false,
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
      badgeColor: 'text-emerald-400 bg-emerald-950/60 border border-emerald-500/20',
      isActive: !isPlanModalOpen,
      onClick: () => {
        onNavigateStudio();
        onCloseMobile();
      },
    },
    {
      id: 'plans',
      label: 'Plans & Billing',
      icon: CreditCard,
      badge: currentUser?.subscription_tier
        ? currentUser.subscription_tier.toUpperCase()
        : undefined,
      badgeColor: 'text-slate-300 bg-slate-800 border border-slate-700',
      isActive: isPlanModalOpen,
      onClick: () => {
        onOpenPlanModal();
        onCloseMobile();
      },
    },
    {
      id: 'gmail',
      label: 'Email Alerts',
      icon: Mail,
      isActive: false,
      onClick: () => {
        if (onOpenGmail) onOpenGmail();
        onCloseMobile();
      },
    },
    {
      id: 'tutorials',
      label: 'Documentation',
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
      badge:
        unreadNotificationsCount > 0 ? String(unreadNotificationsCount) : undefined,
      badgeColor: 'text-white bg-red-600 font-bold',
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
      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="lg:hidden fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* Main Collapsible Sidebar & Mobile Slide-Over */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-slate-950 border-r border-slate-800/80 transition-all duration-300 ease-in-out ${
          isMobileOpen
            ? 'translate-x-0 shadow-2xl'
            : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'lg:w-[88px]' : 'lg:w-64'} w-72`}
      >
        {/* Sidebar Header / Brand Logo & Toggle Controls */}
        <div
          className={`h-16 flex items-center justify-between border-b border-slate-800/80 shrink-0 w-full transition-all ${
            isCollapsed && !isMobileOpen ? 'px-2.5' : 'px-4'
          }`}
        >
          {/* Logo & Brand Title */}
          <div
            onClick={() => {
              onNavigateStudio();
              onCloseMobile();
            }}
            className={`flex items-center cursor-pointer min-w-0 select-none ${
              isCollapsed && !isMobileOpen
                ? 'space-x-1.5'
                : 'space-x-2.5 flex-1 mr-3 overflow-hidden'
            }`}
            title="StreamPulse - Cloud Live Studio"
          >
            <div
              className={`relative flex items-center justify-center rounded-lg overflow-hidden bg-slate-900 border border-slate-800 shrink-0 transition-all ${
                isCollapsed && !isMobileOpen ? 'w-7 h-7' : 'w-8 h-8'
              }`}
            >
              <img
                src={logoImg}
                alt="StreamPulse"
                className="w-full h-full object-contain p-0.5"
              />
              {activeStreamsCount > 0 && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-1 ring-slate-950" />
              )}
            </div>

            {(!isCollapsed || isMobileOpen) && (
              <div className="min-w-0 flex-1 truncate">
                <div className="font-bold text-sm text-white tracking-tight leading-snug truncate">
                  StreamPulse
                </div>
                <div className="text-[10px] text-slate-400 leading-none truncate mt-0.5">
                  Cloud Live Studio
                </div>
              </div>
            )}
          </div>

          {/* Desktop Collapse / Expand Toggle Button */}
          <button
            onClick={onToggleCollapse}
            className={`hidden lg:flex items-center justify-center rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0 ${
              isCollapsed && !isMobileOpen ? 'w-7 h-7' : 'w-8 h-8'
            }`}
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>

          {/* Mobile Close Button */}
          <button
            onClick={onCloseMobile}
            className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
            aria-label="Close navigation"
            title="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Primary Action Button (New Stream or Activate Plan) */}
        <div className="p-3 shrink-0">
          {isPlanActive ? (
            <button
              onClick={() => {
                onOpenCreateModal();
                onCloseMobile();
              }}
              className={`w-full py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs transition-colors cursor-pointer flex items-center shadow-sm ${
                isCollapsed && !isMobileOpen
                  ? 'justify-center'
                  : 'justify-center space-x-2'
              }`}
              title="Create New Live Stream"
            >
              <Plus className="w-4 h-4 shrink-0 stroke-[2.5]" />
              {(!isCollapsed || isMobileOpen) && <span>New Stream</span>}
            </button>
          ) : (
            <button
              onClick={() => {
                onOpenPlanModal();
                onCloseMobile();
              }}
              className={`w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-medium text-xs transition-colors cursor-pointer flex items-center ${
                isCollapsed && !isMobileOpen
                  ? 'justify-center'
                  : 'justify-center space-x-2'
              }`}
              title="Select Subscription Plan"
            >
              <Lock className="w-4 h-4 shrink-0 text-amber-400" />
              {(!isCollapsed || isMobileOpen) && <span>Activate Plan</span>}
            </button>
          )}
        </div>

        {/* Navigation Items List */}
        <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-1 scrollbar-thin scrollbar-thumb-slate-800">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`w-full flex items-center rounded-xl py-2 px-3 text-xs font-medium transition-colors cursor-pointer ${
                  isCollapsed && !isMobileOpen
                    ? 'justify-center'
                    : 'justify-between'
                } ${
                  item.isActive
                    ? 'bg-slate-900 text-white border border-slate-800 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-900/60 border border-transparent'
                }`}
                title={item.label}
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      item.isActive ? 'text-red-400' : 'text-slate-400'
                    }`}
                  />
                  {(!isCollapsed || isMobileOpen) && (
                    <span className="truncate">{item.label}</span>
                  )}
                </div>

                {(!isCollapsed || isMobileOpen) && item.badge && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${
                      item.badgeColor || 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Operational Status Footnote */}
        {(!isCollapsed || isMobileOpen) && (
          <div className="px-4 py-2 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Platform Status</span>
            </span>
            <span className="text-slate-300 font-medium">Operational</span>
          </div>
        )}

        {/* Sidebar Footer: User Profile & Legal Policies */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950 shrink-0 space-y-2">
          {currentUser ? (
            <div
              className={`flex items-center rounded-xl p-2 bg-slate-900/60 border border-slate-800 ${
                isCollapsed && !isMobileOpen
                  ? 'justify-center'
                  : 'justify-between'
              }`}
            >
              <div
                onClick={() => {
                  onOpenAuthModal();
                  onCloseMobile();
                }}
                className="flex items-center space-x-2.5 min-w-0 cursor-pointer"
                title="Account Settings"
              >
                <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-xs shrink-0">
                  {currentUser.email
                    ? currentUser.email.charAt(0).toUpperCase()
                    : 'U'}
                </div>
                {(!isCollapsed || isMobileOpen) && (
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
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
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => {
                onOpenAuthModal();
                onCloseMobile();
              }}
              className={`w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium cursor-pointer flex items-center ${
                isCollapsed && !isMobileOpen
                  ? 'justify-center'
                  : 'justify-center space-x-2'
              }`}
            >
              <User className="w-4 h-4 text-slate-400" />
              {(!isCollapsed || isMobileOpen) && <span>Sign In</span>}
            </button>
          )}

          {/* Legal Links */}
          {(!isCollapsed || isMobileOpen) && onOpenLegal && (
            <div className="flex items-center justify-center space-x-2 text-[10px] text-slate-500 pt-0.5">
              <button
                onClick={() => {
                  onOpenLegal('terms');
                  onCloseMobile();
                }}
                className="hover:text-slate-300 cursor-pointer"
              >
                Terms
              </button>
              <span>&middot;</span>
              <button
                onClick={() => {
                  onOpenLegal('privacy');
                  onCloseMobile();
                }}
                className="hover:text-slate-300 cursor-pointer"
              >
                Privacy
              </button>
              <span>&middot;</span>
              <button
                onClick={() => {
                  onOpenLegal('terms', 'aup');
                  onCloseMobile();
                }}
                className="hover:text-slate-300 cursor-pointer"
              >
                Acceptable Use
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
