import React, { useState, useEffect } from 'react';
import {
  Bell,
  Clock,
  AlertTriangle,
  Gift,
  CheckCircle2,
  X,
  Zap,
  ArrowRight,
  Loader2,
  RefreshCw,
  Tag,
} from 'lucide-react';
import { apiClient, InAppNotification, UserProfile } from '../services/apiClient';

interface NotificationsCenterModalProps {
  currentUser: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onUserUpdated?: (user: UserProfile) => void;
}

export const NotificationsCenterModal: React.FC<NotificationsCenterModalProps> = ({
  currentUser,
  isOpen,
  onClose,
  onUserUpdated,
}) => {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRenewing, setIsRenewing] = useState<boolean>(false);
  const [renewFeedback, setRenewFeedback] = useState<string | null>(null);

  const fetchNotifs = async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.getNotifications(currentUser.id);
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (e) {
      console.warn('Failed to load notifications', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifs();
      setRenewFeedback(null);
    }
  }, [isOpen, currentUser.id]);

  if (!isOpen) return null;

  const handleMarkRead = async (id: string) => {
    await apiClient.markNotificationRead(id);
    fetchNotifs();
  };

  // 1-Click Renewal
  const handleOneClickRenew = async () => {
    setIsRenewing(true);
    setRenewFeedback(null);
    try {
      const res = await apiClient.renewPlan({
        userId: currentUser.id,
      });

      setRenewFeedback(`🎉 ${res.message} Paid ${res.amountBdt} BDT.`);
      if (onUserUpdated && res.user) {
        onUserUpdated(res.user);
      }
      fetchNotifs();
    } catch (err: any) {
      setRenewFeedback(err.message || 'Renewal failed');
    } finally {
      setIsRenewing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-6 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-red-600/10 border border-red-500/20 text-red-500 flex items-center justify-center">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-extrabold text-white tracking-tight">
                  Automated Expiry &amp; Renewal Alerts
                </h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white">
                    {unreadCount} New
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Automated 24h &amp; 2h background cron triggers with seamless 1-click renewal
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1-Click Fast Renewal Banner if Expiry Near or Active */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-red-950/60 via-slate-950 to-amber-950/40 border border-red-800/40 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                {currentUser.subscription_tier} Tier &middot; Continuous Broadcast Pass
              </span>
            </div>
            <span className="text-[11px] text-slate-300 font-mono">
              {currentUser.expires_at ? `Expires ${new Date(currentUser.expires_at).toLocaleDateString()}` : '30-Day Active'}
            </span>
          </div>

          <p className="text-[11px] text-slate-300 leading-relaxed">
            Ensure non-stop 24/7 streaming without manual setup or disconnection. 1-click renews for an additional 30 days instantly.
          </p>

          <button
            onClick={handleOneClickRenew}
            disabled={isRenewing}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-emerald-950/60 hover:shadow-lg hover:shadow-emerald-500/25 cursor-pointer flex items-center justify-center space-x-2"
          >
            {isRenewing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Renewing 30 Days...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-current" />
                <span>Seamless 1-Click Renew (+30 Days)</span>
              </>
            )}
          </button>

          {renewFeedback && (
            <p className="text-xs text-emerald-300 bg-emerald-950/60 p-2.5 rounded-xl border border-emerald-800">
              {renewFeedback}
            </p>
          )}
        </div>

        {/* In-Dashboard Alerts History */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
            <span>In-Dashboard Notifications ({notifications.length})</span>
            <button
              onClick={fetchNotifs}
              className="hover:text-white flex items-center space-x-1"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {notifications.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-slate-950/40 border border-slate-800/60 text-xs text-slate-400">
              No notifications yet. You will receive automated alerts 24h &amp; 2h before your subscription expires.
            </div>
          ) : (
            notifications.map((notif) => {
              const isUrgent = notif.type === 'expiry_2h' || notif.type === 'expired';
              const isWarning = notif.type === 'expiry_24h';
              const isGift = notif.type === 'referral_reward';

              return (
                <div
                  key={notif.id}
                  onClick={() => handleMarkRead(notif.id)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    !notif.is_read
                      ? isUrgent
                        ? 'bg-red-950/40 border-red-800/70 shadow-md'
                        : isWarning
                        ? 'bg-amber-950/30 border-amber-800/60 shadow-md'
                        : 'bg-slate-950 border-slate-800'
                      : 'bg-slate-950/40 border-slate-900 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start space-x-3">
                      <div
                        className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          isUrgent
                            ? 'bg-red-500/20 text-red-400'
                            : isWarning
                            ? 'bg-amber-500/20 text-amber-400'
                            : isGift
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isUrgent ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : isWarning ? (
                          <Clock className="w-4 h-4" />
                        ) : isGift ? (
                          <Gift className="w-4 h-4" />
                        ) : (
                          <Bell className="w-4 h-4" />
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <h4 className="text-xs font-bold text-white">{notif.title}</h4>
                          {!notif.is_read && (
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {notif.message}
                        </p>
                        <span className="text-[10px] text-slate-400 block pt-1">
                          {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &middot; {new Date(notif.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {(isUrgent || isWarning) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOneClickRenew();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-sm shrink-0"
                      >
                        1-Click Renew
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
