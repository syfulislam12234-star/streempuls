import React from 'react';
import {
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Lock,
  User,
  Bell,
  BookOpen,
  Radio,
  ChevronRight,
  CreditCard,
} from 'lucide-react';
import { UserProfile } from '../services/apiClient';
import logoImg from '../assets/images/streampulse_logo_1791782499836.jpg';

export interface NavbarProps {
  currentUser: UserProfile | null;
  activeStreamsCount: number;
  unreadNotificationsCount?: number;
  currentView?: 'studio';
  isSidebarCollapsed?: boolean;
  onToggleSidebarCollapse?: () => void;
  onOpenMobileSidebar?: () => void;
  onNavigateStudio?: () => void;
  isPlanModalOpen?: boolean;
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
  isSidebarCollapsed = false,
  onToggleSidebarCollapse,
  onOpenMobileSidebar,
  onNavigateStudio,
  isPlanModalOpen = false,
  onOpenCreateModal,
  onOpenPlanModal,
  onOpenAuthModal,
  onOpenTutorials,
  onOpenNotificationsModal,
  onLogout,
}) => {
  const isPlanActive = currentUser?.subscription_status === 'active';

  return (
    <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md sticky top-0 z-40 h-16 shrink-0 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
        {/* Left Side: Mobile Menu Button, Desktop Collapse Toggle & Breadcrumbs */}
        <div className="flex items-center space-x-3">
          {/* Mobile Sidebar Toggle Button */}
          {onOpenMobileSidebar && (
            <button
              onClick={onOpenMobileSidebar}
              className="lg:hidden p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
              aria-label="Open sidebar menu"
              title="Open sidebar menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          {/* Desktop Sidebar Collapse Toggle */}
          {onToggleSidebarCollapse && (
            <button
              onClick={onToggleSidebarCollapse}
              className="hidden lg:flex p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Brand Logo & Breadcrumb Navigation */}
          <div className="flex items-center space-x-2.5">
            <div
              onClick={onNavigateStudio}
              className="flex items-center space-x-2.5 cursor-pointer"
            >
              <div className="relative flex items-center justify-center w-8 h-8 rounded-lg overflow-hidden bg-slate-900 border border-slate-800 shadow-sm shrink-0">
                <img src={logoImg} alt="StreamPulse Logo" className="w-full h-full object-contain p-0.5" />
                {activeStreamsCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              <span className="font-bold text-sm tracking-tight text-white hidden sm:inline">
                StreamPulse
              </span>
            </div>

            <ChevronRight className="w-3.5 h-3.5 text-slate-600 hidden sm:inline" />

            {/* Active Workspace / Route Tag */}
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-semibold text-slate-300">
                {isPlanModalOpen ? 'Plans & Billing' : 'Live Studio'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Operational Health, Quotas, Quick Actions, Notifications & Account */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Minimal Enterprise System Health Indicator */}
          <div className="hidden xl:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>System:</span>
            <span className="text-slate-200 font-medium">Operational</span>
          </div>

          {/* Plans & Billing Button */}
          <button
            onClick={onOpenPlanModal}
            className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
              isPlanModalOpen
                ? 'bg-red-950/40 border-red-600/70 text-white shadow-sm'
                : isPlanActive
                ? 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300 hover:bg-amber-900/40'
            }`}
            title="Click to view subscription plans, quotas, and billing"
          >
            <CreditCard className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="capitalize hidden xs:inline">
              {currentUser?.subscription_tier
                ? `${currentUser.subscription_tier} Plan`
                : 'Plans & Billing'}
            </span>
            <span className="capitalize xs:hidden">Plans</span>
          </button>

          {/* Broadcast Status Indicator */}
          {isPlanActive && (
            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                activeStreamsCount > 0
                  ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeStreamsCount > 0
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-slate-500'
                }`}
              />
              <span className="hidden sm:inline">
                {activeStreamsCount > 0 ? `${activeStreamsCount} Live` : 'Standby'}
              </span>
            </div>
          )}

          {/* Primary Action Button (Create Stream) */}
          {isPlanActive ? (
            <button
              onClick={onOpenCreateModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden xs:inline">New Stream</span>
            </button>
          ) : (
            <button
              onClick={onOpenPlanModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <span>Activate Plan</span>
            </button>
          )}

          {/* Tutorials & Documentation */}
          {onOpenTutorials && (
            <button
              onClick={onOpenTutorials}
              className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
              title="Documentation & Guides"
            >
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden md:inline">Docs</span>
            </button>
          )}

          {/* Notifications Center */}
          {onOpenNotificationsModal && (
            <button
              onClick={onOpenNotificationsModal}
              className="relative p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>
          )}

          {/* User Account Button */}
          <button
            onClick={onOpenAuthModal}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
            title="User Account"
          >
            <User className="w-3.5 h-3.5 text-slate-400" />
            <span className="max-w-[90px] sm:max-w-[120px] truncate hidden sm:inline">
              {currentUser?.email ? currentUser.email.split('@')[0] : 'Account'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
