import React, { useState, useEffect } from 'react';
import {
  Mail,
  X,
  Send,
  Trash2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Inbox,
  Clock,
  User as UserIcon,
  ExternalLink,
  ShieldCheck,
  LogOut,
  Radio,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, googleLogout, getAccessToken } from '../services/googleAuth';
import { gmailClient, GmailMessageSummary, GmailUserProfile } from '../services/gmailClient';

interface GmailManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GmailManagerModal: React.FC<GmailManagerModalProps> = ({ isOpen, onClose }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Gmail State
  const [profile, setProfile] = useState<GmailUserProfile | null>(null);
  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'inbox' | 'compose'>('inbox');

  // Compose State
  const [recipient, setRecipient] = useState<string>('');
  const [subject, setSubject] = useState<string>('🔴 Live Stream Notification - StreamPulse');
  const [messageBody, setMessageBody] = useState<string>(
    'Hello!\n\nOur 24/7 automated live stream broadcast is now LIVE on YouTube. Join our broadcast now:\n\nStream Pulse Studio'
  );
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  // Confirmation Dialog States (Mandatory requirement for destructive/mutating Workspace operations)
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionType: 'trash' | 'send';
    targetId?: string;
  } | null>(null);

  // Initialize Auth state listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      () => {
        setCurrentUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  // Fetch Gmail data whenever token is available and modal is open
  useEffect(() => {
    if (isOpen && accessToken && !needsAuth) {
      loadGmailData();
    }
  }, [isOpen, accessToken, needsAuth]);

  const loadGmailData = async () => {
    setIsLoadingMessages(true);
    try {
      const [userProfile, messagesData] = await Promise.all([
        gmailClient.getProfile().catch(() => null),
        gmailClient.listMessages({ q: searchQuery || undefined }),
      ]);

      if (userProfile) setProfile(userProfile);
      if (messagesData) setMessages(messagesData.messages);
    } catch (err: any) {
      console.error('[Gmail Manager] Load error:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setCurrentUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
        loadGmailData();
      }
    } catch (err: any) {
      setAuthError(err.message || 'Failed to authenticate with Google. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await googleLogout();
    setCurrentUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
    setProfile(null);
    setMessages([]);
  };

  // 1. Compose: Request Confirmation before sending email
  const handleTriggerSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient || !subject || !messageBody) return;

    setConfirmDialog({
      isOpen: true,
      title: 'Confirm Send Email via Gmail',
      description: `Are you sure you want to send this email to "${recipient}" with subject "${subject}" from your connected Google account?`,
      actionType: 'send',
    });
  };

  // 2. Trash: Request Confirmation before deleting email
  const handleTriggerTrashEmail = (msgId: string, subjectTitle: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Move Email to Trash?',
      description: `Are you sure you want to move the email "${subjectTitle || '(No Subject)'}" to Trash? This will remove it from your primary inbox.`,
      actionType: 'trash',
      targetId: msgId,
    });
  };

  // Execute confirmed mutating action
  const handleExecuteConfirmedAction = async () => {
    if (!confirmDialog) return;
    const { actionType, targetId } = confirmDialog;
    setConfirmDialog(null);

    if (actionType === 'send') {
      setIsSending(true);
      setSendSuccess(null);
      try {
        await gmailClient.sendEmail({
          to: recipient,
          subject,
          bodyText: messageBody,
        });
        setSendSuccess(`Email successfully sent to ${recipient}!`);
        setRecipient('');
        setTimeout(() => setSendSuccess(null), 5000);
      } catch (err: any) {
        alert(err.message || 'Failed to send email via Gmail.');
      } finally {
        setIsSending(false);
      }
    } else if (actionType === 'trash' && targetId) {
      try {
        await gmailClient.trashMessage(targetId);
        setMessages((prev) => prev.filter((m) => m.id !== targetId));
      } catch (err: any) {
        alert(err.message || 'Failed to trash email.');
      }
    }
  };

  const applyTemplate = (type: 'live' | 'schedule' | 'receipt') => {
    if (type === 'live') {
      setSubject('🔴 Live Stream Notification - StreamPulse');
      setMessageBody(
        `Hello,\n\nOur 24/7 continuous live stream broadcast has just started!\n\nTune in now on YouTube:\nhttps://youtube.com/live\n\nBest regards,\nStreamPulse Broadcaster`
      );
    } else if (type === 'schedule') {
      setSubject('📅 Stream Schedule Update - StreamPulse');
      setMessageBody(
        `Hi everyone,\n\nHere is an update regarding our upcoming 24/7 live stream schedule and video playlists.\n\nThank you for watching!\nStreamPulse Team`
      );
    } else if (type === 'receipt') {
      setSubject('🧾 StreamPulse Subscription Confirmation');
      setMessageBody(
        `Dear Streamer,\n\nYour subscription has been verified and your 24/7 cloud live broadcast pipeline is fully active.\n\nThank you for choosing StreamPulse!`
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div className="w-full max-w-3xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* MODAL HEADER */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-red-600/15 border border-red-500/30 flex items-center justify-center text-red-500 shadow-sm">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-extrabold text-white">Gmail Integration Hub</h3>
                <span className="px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-800/40 text-[10px] font-bold">
                  Google Workspace
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Send stream alerts, viewer notifications, and manage emails with permission from your Google account.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          {/* AUTH STATUS & LOGIN VIEW */}
          {needsAuth || !accessToken ? (
            <div className="p-8 text-center space-y-6 bg-slate-950/50 rounded-2xl border border-slate-800/80">
              <div className="w-16 h-16 rounded-3xl bg-red-600/10 border border-red-500/20 flex items-center justify-center text-red-500 mx-auto">
                <Mail className="w-8 h-8" />
              </div>

              <div className="max-w-md mx-auto space-y-2">
                <h4 className="text-lg font-bold text-white">Connect Your Gmail Account</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Sign in with Google to enable Gmail features in StreamPulse. This will allow the app to read, compose, and send broadcast alerts with your explicit permission.
                </p>
              </div>

              {authError && (
                <div className="max-w-md mx-auto p-3 rounded-xl bg-red-950/80 border border-red-800 text-red-300 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{authError}</span>
                </div>
              )}

              {/* Official Google Material Sign-In Button */}
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isLoggingIn}
                  className="px-6 py-3 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs shadow-xl cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center space-x-3 border border-slate-300 disabled:opacity-60"
                >
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                  <span>{isLoggingIn ? 'Connecting to Google...' : 'Sign in with Google'}</span>
                </button>
              </div>

              <div className="flex items-center justify-center space-x-2 text-[11px] text-slate-500 pt-3">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Protected by Google Identity Services &amp; OAuth 2.0</span>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* CONNECTED USER BADGE */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-rose-600 flex items-center justify-center text-white font-bold text-sm">
                    {profile?.emailAddress?.charAt(0).toUpperCase() || currentUser?.email?.charAt(0).toUpperCase() || 'G'}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <span>{currentUser?.displayName || 'Connected Google Account'}</span>
                      <span className="flex items-center space-x-1 text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>ACTIVE</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {profile?.emailAddress || currentUser?.email}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={loadGmailData}
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
                    title="Refresh Inbox"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoadingMessages ? 'animate-spin text-red-400' : ''}`} />
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-red-950/60 border border-slate-800 hover:border-red-800 text-slate-300 hover:text-red-400 text-xs font-semibold cursor-pointer flex items-center space-x-1.5 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Disconnect</span>
                  </button>
                </div>
              </div>

              {/* TABS HEADER */}
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
                <button
                  onClick={() => setActiveTab('inbox')}
                  className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-2 ${
                    activeTab === 'inbox'
                      ? 'bg-red-600 text-white shadow-lg shadow-red-950/50'
                      : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                  }`}
                >
                  <Inbox className="w-4 h-4" />
                  <span>Recent Inbox ({messages.length})</span>
                </button>

                <button
                  onClick={() => setActiveTab('compose')}
                  className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-2 ${
                    activeTab === 'compose'
                      ? 'bg-red-600 text-white shadow-lg shadow-red-950/50'
                      : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                  }`}
                >
                  <Send className="w-4 h-4" />
                  <span>Send Stream Alert / Email</span>
                </button>
              </div>

              {/* TAB 1: INBOX */}
              {activeTab === 'inbox' && (
                <div className="space-y-4">
                  {/* Search Filter */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && loadGmailData()}
                      placeholder="Search messages (e.g. stream, alert, payment)... Press Enter"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
                    />
                  </div>

                  {isLoadingMessages ? (
                    <div className="py-12 text-center space-y-2">
                      <RefreshCw className="w-6 h-6 text-red-500 animate-spin mx-auto" />
                      <p className="text-xs text-slate-400">Loading messages from your Gmail inbox...</p>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="py-12 text-center space-y-2 bg-slate-950/40 rounded-2xl border border-slate-800">
                      <Mail className="w-8 h-8 text-slate-600 mx-auto" />
                      <p className="text-xs text-slate-400">No matching messages found in your inbox.</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[380px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className="p-3.5 rounded-2xl bg-slate-950/70 hover:bg-slate-950 border border-slate-800/80 hover:border-slate-700 flex items-start justify-between gap-3 transition-colors"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center space-x-2">
                              {msg.isUnread && (
                                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                              )}
                              <span className="text-xs font-bold text-white truncate">
                                {msg.subject || '(No Subject)'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              <span className="text-slate-300 font-semibold">From:</span> {msg.from}
                            </div>
                            <p className="text-[11px] text-slate-500 line-clamp-1">
                              {msg.snippet}
                            </p>
                          </div>

                          <div className="flex flex-col items-end space-y-2 shrink-0">
                            <span className="text-[10px] text-slate-500 font-mono">
                              {msg.date ? new Date(msg.date).toLocaleDateString() : ''}
                            </span>
                            <button
                              onClick={() => handleTriggerTrashEmail(msg.id, msg.subject || '')}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors cursor-pointer"
                              title="Move to Trash (Requires Confirmation)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: COMPOSE / SEND STREAM ALERTS */}
              {activeTab === 'compose' && (
                <form onSubmit={handleTriggerSendEmail} className="space-y-4">
                  {sendSuccess && (
                    <div className="p-3.5 rounded-2xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>{sendSuccess}</span>
                    </div>
                  )}

                  {/* Quick Stream Email Templates */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400 font-semibold block">Quick Broadcast Templates</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyTemplate('live')}
                        className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                      >
                        🔴 Live Broadcast Started
                      </button>
                      <button
                        type="button"
                        onClick={() => applyTemplate('schedule')}
                        className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                      >
                        📅 Stream Schedule Update
                      </button>
                      <button
                        type="button"
                        onClick={() => applyTemplate('receipt')}
                        className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                      >
                        🧾 Subscription Confirmation
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-300 font-bold block">Recipient Email *</label>
                    <input
                      type="email"
                      required
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="e.g. subscriber@example.com or your-email@gmail.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-300 font-bold block">Subject *</label>
                    <input
                      type="text"
                      required
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-300 font-bold block">Message Body *</label>
                    <textarea
                      required
                      rows={6}
                      value={messageBody}
                      onChange={(e) => setMessageBody(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-sans text-xs focus:border-red-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSending}
                      className="px-6 py-3 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold shadow-lg shadow-red-950/60 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center space-x-2 disabled:opacity-60"
                    >
                      <Send className="w-4 h-4" />
                      <span>{isSending ? 'Sending...' : 'Send Email via Gmail'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* MANDATORY USER CONFIRMATION MODAL FOR DESTRUCTIVE / MUTATING ACTIONS */}
      {/* Required by Workspace skill: Must require explicit confirmation      */}
      {/* ==================================================================== */}
      {confirmDialog && confirmDialog.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-3">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                  confirmDialog.actionType === 'trash'
                    ? 'bg-red-600/15 border border-red-500/30 text-red-500'
                    : 'bg-emerald-600/15 border border-emerald-500/30 text-emerald-500'
                }`}
              >
                {confirmDialog.actionType === 'trash' ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <Mail className="w-5 h-5" />
                )}
              </div>
              <h4 className="text-base font-bold text-white">{confirmDialog.title}</h4>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {confirmDialog.description}
            </p>

            <div className="flex justify-end space-x-2 pt-3">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteConfirmedAction}
                className={`px-5 py-2.5 rounded-xl text-white text-xs font-bold shadow-lg cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] ${
                  confirmDialog.actionType === 'trash'
                    ? 'bg-red-600 hover:bg-red-500 shadow-red-950/50'
                    : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/50'
                }`}
              >
                {confirmDialog.actionType === 'trash' ? 'Confirm Trash Email' : 'Confirm & Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
