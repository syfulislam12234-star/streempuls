/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { StreamingDashboard } from './components/StreamingDashboard';
import { PlanSelectionScreen } from './components/PlanSelectionScreen';
import { AuthModal } from './components/AuthModal';
import { NotificationsCenterModal } from './components/NotificationsCenterModal';
import { LegalTermsModal } from './components/LegalTermsModal';
import { TutorialsModal } from './components/TutorialsModal';
import { AdminDashboardPortal } from './components/AdminDashboardPortal';
import { GmailManagerModal } from './components/GmailManagerModal';
import { ArchitectureVault } from './components/ArchitectureVault';
import { apiClient, UserProfile } from './services/apiClient';
import { Loader2, X, Layers, CreditCard } from 'lucide-react';
import { RealtimeSyncProvider, useRealtimeSync } from './context/RealtimeSyncContext';

const isCurrentUrlAdmin = (): boolean => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  return (
    host === 'admin.streampulse.io' ||
    host.startsWith('admin.') ||
    path.startsWith('/admin')
  );
};

function MainApp() {
  const { broadcastNotice } = useRealtimeSync();
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState<boolean>(true);
  const [currentView, setCurrentView] = useState<'studio' | 'admin'>(() => {
    return isCurrentUrlAdmin() ? 'admin' : 'studio';
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [activeStreamsCount, setActiveStreamsCount] = useState<number>(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState<boolean>(false);
  const [isTutorialsModalOpen, setIsTutorialsModalOpen] = useState<boolean>(false);
  const [isGmailModalOpen, setIsGmailModalOpen] = useState<boolean>(false);
  const [isArchitectureModalOpen, setIsArchitectureModalOpen] = useState<boolean>(false);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState<boolean>(false);
  const [legalInitialTab, setLegalInitialTab] = useState<'terms' | 'privacy'>('terms');
  const [legalInitialSection, setLegalInitialSection] = useState<string | undefined>(undefined);

  // Sync back/forward browser history
  useEffect(() => {
    const onPopState = () => {
      setCurrentView(isCurrentUrlAdmin() ? 'admin' : 'studio');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleNavigateToAdmin = () => {
    setCurrentView('admin');
    try {
      if (window.location.hostname !== 'admin.streampulse.io') {
        window.history.pushState({ view: 'admin' }, '', '/admin');
      }
    } catch (e) {}
  };

  const handleNavigateToStudio = () => {
    setCurrentView('studio');
    try {
      window.history.pushState({ view: 'studio' }, '', '/');
    } catch (e) {}
  };

  const handleOpenLegal = (tab?: 'terms' | 'privacy', sectionId?: string) => {
    setLegalInitialTab(tab || 'terms');
    setLegalInitialSection(sectionId);
    setIsLegalModalOpen(true);
  };

  // 1. Fetch current authenticated user session on mount
  const refreshUser = useCallback(async () => {
    try {
      const user = await apiClient.getCurrentUser();
      if (user) {
        setCurrentUser(user);
      } else {
        // Fallback default unpaid user profile to enforce post-login guard
        const fallbackUsers = await apiClient.getUsers();
        if (fallbackUsers.length > 0) {
          setCurrentUser(fallbackUsers[0]);
          apiClient.setStoredUserId(fallbackUsers[0].id);
        }
      }
    } catch (e) {
      console.warn('[StreamPulse Auth] Error fetching current user:', e);
    } finally {
      setIsLoadingUser(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // 2. Sync live streams count from real backend
  useEffect(() => {
    const fetchStreamCount = async () => {
      try {
        const streams = await apiClient.getStreams();
        if (Array.isArray(streams)) {
          const liveCount = streams.filter((s) => s.status === 'live').length;
          setActiveStreamsCount(liveCount);
        }
      } catch (e) {
        // Graceful handling
      }
    };

    fetchStreamCount();
    const intervalId = setInterval(fetchStreamCount, 4000);
    return () => clearInterval(intervalId);
  }, []);

  // 3. Poll notifications unread count
  useEffect(() => {
    if (!currentUser?.id) return;
    const fetchUnread = async () => {
      try {
        const notifData = await apiClient.getNotifications(currentUser.id);
        setUnreadNotificationsCount(notifData.unreadCount);
      } catch (e) {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 10000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  // Post-Login Plan Guard check:
  // Requires user.subscription_status === 'active' to access RTMP streaming studio
  const isPlanActive = currentUser?.subscription_status === 'active';

  // Logout handler
  const handleLogout = async () => {
    apiClient.logoutUser();
    // Re-fetch me or default user (defaults to unpaid test user)
    const users = await apiClient.getUsers();
    const unpaidTestUser = users.find((u) => u.subscription_status === 'unpaid') || users[0];
    if (unpaidTestUser) {
      apiClient.setStoredUserId(unpaidTestUser.id);
      setCurrentUser(unpaidTestUser);
    } else {
      setCurrentUser(null);
    }
    setIsPlanModalOpen(false);
  };

  // Quick verification helper: toggle current user status to 'unpaid' to test the guard
  const handleSimulateUnpaid = async () => {
    if (!currentUser) return;
    try {
      const updated = await apiClient.resetSubscriptionStatus(currentUser.id, 'unpaid');
      setCurrentUser(updated);
      setIsPlanModalOpen(false);
    } catch (e) {
      console.error('Failed to simulate unpaid status', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex font-sans selection:bg-red-600 selection:text-white">
      {/* Sleek, Collapsible Modern Side Navigation Bar (Sidebar) */}
      <Sidebar
        currentUser={currentUser}
        activeStreamsCount={activeStreamsCount}
        unreadNotificationsCount={unreadNotificationsCount}
        currentView={currentView}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev: boolean) => !prev)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onOpenMobile={() => setIsMobileSidebarOpen(true)}
        onNavigateStudio={handleNavigateToStudio}
        onNavigateAdmin={handleNavigateToAdmin}
        isPlanModalOpen={isPlanModalOpen}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        onOpenPlanModal={() => setIsPlanModalOpen(true)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onOpenTutorials={() => setIsTutorialsModalOpen(true)}
        onOpenNotificationsModal={() => setIsNotificationsModalOpen(true)}
        onOpenGmail={() => setIsGmailModalOpen(true)}
        onOpenArchitecture={() => setIsArchitectureModalOpen(true)}
        onOpenLegal={handleOpenLegal}
        onLogout={handleLogout}
      />

      {/* Main Content Area adjusting dynamically with left margin so it never overlaps sidebar */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
        }`}
      >
        {/* Unified Top Navigation Bar across both Mobile and Desktop */}
        <Navbar
          currentUser={currentUser}
          activeStreamsCount={activeStreamsCount}
          unreadNotificationsCount={unreadNotificationsCount}
          currentView={currentView}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebarCollapse={() => setIsSidebarCollapsed((prev: boolean) => !prev)}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onNavigateStudio={handleNavigateToStudio}
          onNavigateAdmin={handleNavigateToAdmin}
          isPlanModalOpen={isPlanModalOpen}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
          onOpenPlanModal={() => setIsPlanModalOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onOpenTutorials={() => setIsTutorialsModalOpen(true)}
          onOpenNotificationsModal={() => setIsNotificationsModalOpen(true)}
          onLogout={handleLogout}
        />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {currentView === 'admin' ? (
            <AdminDashboardPortal
              currentUser={currentUser}
              onNavigateToStudio={handleNavigateToStudio}
              hideHeader={true}
            />
          ) : isLoadingUser ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3">
              <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
              <p className="text-sm text-slate-400">Loading user profile and studio permissions...</p>
            </div>
          ) : !isPlanActive ? (
            /* ==================================================================== */
            /* POST-LOGIN PLAN GUARD: LOCKED VIEW (Subscription Selection Screen)   */
            /* When user.subscription_status !== 'active', instantly locks main     */
            /* dashboard view and renders clean, button-driven plan selection cards */
            /* ==================================================================== */
            <PlanSelectionScreen
              currentUser={
                currentUser || {
                  id: 'usr-unpaid-test-01',
                  email: 'newuser@streampulse.io',
                  full_name: 'New Streamer',
                  role: 'user',
                  subscription_tier: 'free',
                  subscription_status: 'unpaid',
                  channel_limit: 1,
                  video_limit: 1,
                  duration_days: 3,
                  hour_limit: 10,
                  has_watermark: true,
                  is_brand_free: false,
                  price_bdt: 0,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              }
              onPlanActivated={(updatedUser) => {
                setCurrentUser(updatedUser);
                setIsPlanModalOpen(false);
              }}
              onLogout={handleLogout}
              onOpenLegal={handleOpenLegal}
            />
          ) : (
            /* ==================================================================== */
            /* UNLOCKED VIEW: Primary Streaming Dashboard (active subscription)     */
            /* ==================================================================== */
            <StreamingDashboard
              currentUser={currentUser}
              isCreateModalOpen={isCreateModalOpen}
              setIsCreateModalOpen={setIsCreateModalOpen}
              onActiveStreamsChange={setActiveStreamsCount}
              onOpenPlanModal={() => setIsPlanModalOpen(true)}
              onOpenTutorials={() => setIsTutorialsModalOpen(true)}
              onOpenNotificationsModal={() => setIsNotificationsModalOpen(true)}
              onSimulateUnpaid={handleSimulateUnpaid}
            />
          )}
        </main>

        {/* Clean, Non-intrusive Footer */}
        <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-400 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-slate-300">StreamPulse</span>
              <span>&middot;</span>
              <span>24/7 Automated Live Broadcasting Studio</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 text-slate-400 text-xs">
              <button
                onClick={() => setIsTutorialsModalOpen(true)}
                className="hover:text-red-400 underline cursor-pointer text-red-400/90 font-semibold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
              >
                Tutorials &amp; Guides
              </button>
              <span>&middot;</span>
              <button
                onClick={() => handleOpenLegal('terms')}
                className="hover:text-white underline cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
              >
                Terms of Service
              </button>
              <span>&middot;</span>
              <button
                onClick={() => handleOpenLegal('privacy')}
                className="hover:text-white underline cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
              >
                Privacy Policy
              </button>
              <span>&middot;</span>
              <button
                onClick={() => handleOpenLegal('terms', 'aup')}
                className="hover:text-amber-300 underline cursor-pointer text-amber-400/90 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
              >
                Acceptable Use Policy (AUP)
              </button>
            </div>
            <p className="text-slate-400 hidden xl:block">
              Continuous cloud streaming for YouTube &amp; Custom RTMP
            </p>
          </div>
        </footer>
      </div>

      {/* Auth Modal (Account registration, login, and 1-click verification helpers) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          setIsPlanModalOpen(false);
        }}
        onOpenLegal={handleOpenLegal}
      />

      {/* Notifications Modal */}
      {currentUser && (
        <NotificationsCenterModal
          currentUser={currentUser}
          isOpen={isNotificationsModalOpen}
          onClose={() => setIsNotificationsModalOpen(false)}
          onUserUpdated={(updated) => setCurrentUser(updated)}
        />
      )}

      {/* Legal Terms & Privacy Modal */}
      <LegalTermsModal
        isOpen={isLegalModalOpen}
        onClose={() => setIsLegalModalOpen(false)}
        initialTab={legalInitialTab}
        initialSectionId={legalInitialSection}
      />

      {/* Tutorials Modal */}
      <TutorialsModal
        isOpen={isTutorialsModalOpen}
        onClose={() => setIsTutorialsModalOpen(false)}
        currentUser={currentUser}
      />

      {/* Plans & Billing Management Modal (Pop-up overlay with zero dead clicks) */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
          <div className="relative w-full max-w-6xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-5 sm:p-7 my-auto max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0 mb-4 sm:mb-6">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div className="min-w-0 truncate">
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                    Subscription Plans &amp; Billing
                  </h3>
                  <p className="text-xs text-slate-400 truncate">
                    Configure your live broadcast channels, video storage, and streaming quotas
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPlanModalOpen(false)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0 ml-3"
                aria-label="Close billing modal"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="flex-1 overflow-y-auto pr-1">
              <PlanSelectionScreen
                currentUser={
                  currentUser || {
                    id: 'usr-unpaid-test-01',
                    email: 'streamer@streampulse.io',
                    full_name: 'Streamer',
                    role: 'user',
                    subscription_tier: 'free',
                    subscription_status: 'unpaid',
                    channel_limit: 1,
                    video_limit: 1,
                    duration_days: 3,
                    hour_limit: 10,
                    has_watermark: true,
                    is_brand_free: false,
                    price_bdt: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  }
                }
                onPlanActivated={(updatedUser) => {
                  setCurrentUser(updatedUser);
                  setIsPlanModalOpen(false);
                }}
                onLogout={handleLogout}
                onClose={() => setIsPlanModalOpen(false)}
                onOpenLegal={handleOpenLegal}
              />
            </div>
          </div>
        </div>
      )}

      {/* Gmail Integration Modal */}
      <GmailManagerModal
        isOpen={isGmailModalOpen}
        onClose={() => setIsGmailModalOpen(false)}
      />

      {/* System Architecture & Blueprint Modal */}
      {isArchitectureModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
              <div className="flex items-center space-x-2.5">
                <Layers className="w-5 h-5 text-red-500" />
                <div>
                  <h3 className="text-base font-bold text-white">System Architecture &amp; Blueprint</h3>
                  <p className="text-xs text-slate-400">Database schemas, API gateway, FFmpeg workers, and container configuration</p>
                </div>
              </div>
              <button
                onClick={() => setIsArchitectureModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer transition-colors"
                aria-label="Close Architecture Modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ArchitectureVault />
            </div>
          </div>
        </div>
      )}

      {/* Real-Time Auto-Sync Live Toast Notification */}
      {broadcastNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-3 bg-slate-900/95 border border-emerald-500/50 text-white px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md animate-fade-in">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Live Sync:</span>
          <span className="text-xs text-slate-200">{broadcastNotice}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <RealtimeSyncProvider>
      <MainApp />
    </RealtimeSyncProvider>
  );
}
