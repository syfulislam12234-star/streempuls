import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  ShieldCheck,
  Search,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertCircle,
  Clock,
  ExternalLink,
  MessageCircle,
  ImageIcon,
  Eye,
  Check,
  X,
  Loader2,
  User,
  Smartphone,
  Copy,
  Calendar,
} from 'lucide-react';
import { apiClient, UserProfile, PaymentRequest, SubscriptionTier } from '../services/apiClient';

interface AdminPaymentApprovalsProps {
  currentUser: UserProfile | null;
}

export const AdminPaymentApprovals: React.FC<AdminPaymentApprovalsProps> = ({ currentUser }) => {
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Action states
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rejectingPaymentId, setRejectingPaymentId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [copiedTrxId, setCopiedTrxId] = useState<string | null>(null);

  const fetchPaymentRequests = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAdminPaymentRequests(filterStatus === 'all' ? undefined : filterStatus);
      setPayments(data.paymentRequests);
      setTotalCount(data.totalCount);
      setPendingCount(data.pendingCount);
    } catch (err: any) {
      setError(err.message || 'Failed to load manual payment requests.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPaymentRequests();
  }, [filterStatus]);

  const handleApprove = async (payment: PaymentRequest) => {
    if (!window.confirm(`Are you sure you want to approve this payment (${payment.amount_bdt} BDT) and upgrade ${payment.user_email} to ${payment.plan_tier.toUpperCase()} Plan?`)) {
      return;
    }

    setActionLoadingId(payment.id);
    setError(null);
    try {
      const res = await apiClient.approvePaymentRequest(payment.id, currentUser?.id);
      setPayments(payments.map((p) => (p.id === payment.id ? res.paymentRequest : p)));
      setPendingCount((prev) => Math.max(0, prev - 1));
      setSuccessMessage(`🎉 Approved! User ${payment.user_email} is now active on ${payment.plan_tier.toUpperCase()} Plan.`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to approve payment request.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingPaymentId) return;
    setActionLoadingId(rejectingPaymentId);
    setError(null);
    try {
      const res = await apiClient.rejectPaymentRequest(rejectingPaymentId, rejectReason, currentUser?.id);
      setPayments(payments.map((p) => (p.id === rejectingPaymentId ? res.paymentRequest : p)));
      setPendingCount((prev) => Math.max(0, prev - 1));
      setSuccessMessage('Payment request marked as rejected.');
      setRejectingPaymentId(null);
      setRejectReason('');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to reject payment request.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTrxId(text);
    setTimeout(() => setCopiedTrxId(null), 2000);
  };

  const filteredList = payments.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.trx_id.toLowerCase().includes(q) ||
      p.user_email.toLowerCase().includes(q) ||
      (p.user_name && p.user_name.toLowerCase().includes(q)) ||
      (p.sender_phone && p.sender_phone.includes(q)) ||
      p.plan_tier.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-md shadow-emerald-950/50">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                Admin Console
              </span>
              <span className="text-xs font-semibold text-slate-400">
                bKash, Nagad &amp; Rocket Verifications
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-0.5">
              Manual Subscription Payment Approvals
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Review submitted Transaction IDs (TrxID) and payment receipts. Approving automatically unlocks the user's account and updates their multi-channel streaming limits.
            </p>
          </div>
        </div>

        {/* Quick Stats & Refresh Button */}
        <div className="flex items-center gap-3">
          <div className="px-4 py-2.5 rounded-2xl bg-slate-950 border border-slate-800 text-center">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Pending Queue</span>
            <span className="text-lg font-black text-amber-400 font-mono">{pendingCount}</span>
          </div>
          <button
            onClick={fetchPaymentRequests}
            disabled={isLoading}
            className="p-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
            title="Refresh payment requests"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Toast Feedback Messages */}
      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs sm:text-sm flex items-center space-x-2.5 shadow-lg">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="font-semibold">{successMessage}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs sm:text-sm flex items-center space-x-2.5 shadow-lg">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <span className="font-semibold">{error}</span>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status Filter Tabs */}
        <div className="flex items-center space-x-1.5 p-1 rounded-2xl bg-slate-900 border border-slate-800 self-start">
          {[
            { id: 'pending', label: 'Pending', count: pendingCount },
            { id: 'all', label: 'All Requests', count: totalCount },
            { id: 'approved', label: 'Approved' },
            { id: 'rejected', label: 'Rejected' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center space-x-1.5 ${
                filterStatus === tab.id
                  ? 'bg-red-600 text-white shadow-md shadow-red-950/50'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    filterStatus === tab.id
                      ? 'bg-red-800 text-red-100'
                      : tab.id === 'pending' && tab.count > 0
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search TrxID, user email, phone..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors"
          />
        </div>
      </div>

      {/* Main Payment Requests List */}
      <div className="space-y-4">
        {isLoading && payments.length === 0 ? (
          <div className="p-12 text-center rounded-3xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <Loader2 className="w-7 h-7 text-emerald-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Loading manual payment submissions...</p>
          </div>
        ) : filteredList.length === 0 ? (
          <div className="p-12 text-center rounded-3xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-slate-400" />
            </div>
            <h4 className="text-sm font-bold text-white">No Payment Requests Found</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {filterStatus === 'pending'
                ? 'All clear! There are currently no pending payments waiting for review.'
                : 'No payment submissions matched your search query or filter.'}
            </p>
          </div>
        ) : (
          filteredList.map((item) => (
            <div
              key={item.id}
              className={`p-5 rounded-3xl border transition-all duration-200 shadow-xl space-y-4 ${
                item.status === 'pending'
                  ? 'bg-slate-900/95 border-amber-500/30 ring-1 ring-amber-500/20'
                  : item.status === 'approved'
                  ? 'bg-slate-900/80 border-emerald-500/20'
                  : 'bg-slate-900/70 border-slate-800'
              }`}
            >
              {/* Row 1: Header with Plan badge, Amount, and Status */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                <div className="flex items-center space-x-3">
                  <span
                    className={`px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider ${
                      item.plan_tier === 'business'
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                        : item.plan_tier === 'pro'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    }`}
                  >
                    {item.plan_tier} Plan &middot; 30 Days
                  </span>

                  <span className="text-base font-extrabold text-emerald-400 font-mono">
                    {item.amount_bdt.toLocaleString()} BDT
                  </span>

                  {item.coupon_code && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-mono">
                      Coupon: {item.coupon_code}
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold flex items-center space-x-1.5 ${
                      item.status === 'pending'
                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                        : item.status === 'approved'
                        ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                        : 'bg-red-500/10 text-red-300 border border-red-500/30'
                    }`}
                  >
                    {item.status === 'pending' ? (
                      <>
                        <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                        <span>Pending Approval</span>
                      </>
                    ) : item.status === 'approved' ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Approved &amp; Active</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                        <span>Rejected</span>
                      </>
                    )}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &middot;{' '}
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Row 2: Grid of details (Customer, TrxID, Account details, Screenshot) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                {/* User Info */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-1.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block flex items-center space-x-1">
                    <User className="w-3 h-3 text-slate-400" />
                    <span>User Account</span>
                  </span>
                  <span className="text-white font-bold block truncate">{item.user_name || 'Streamer'}</span>
                  <span className="text-slate-300 font-mono block truncate">{item.user_email}</span>
                  <span className="text-[10px] text-slate-400 font-mono block">ID: {item.user_id}</span>
                </div>

                {/* TrxID & Channel */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-1.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Payment Method &amp; TrxID
                  </span>
                  <div className="flex items-center justify-between">
                    <span className="capitalize font-semibold flex items-center space-x-1.5">
                      <Smartphone
                        className={`w-3.5 h-3.5 ${
                          item.payment_method === 'bkash'
                            ? 'text-pink-400'
                            : item.payment_method === 'nagad'
                            ? 'text-amber-400'
                            : 'text-purple-400'
                        }`}
                      />
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase border ${
                          item.payment_method === 'bkash'
                            ? 'bg-pink-500/10 text-pink-400 border-pink-500/20'
                            : item.payment_method === 'nagad'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        }`}
                      >
                        {item.payment_method}
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">To: {item.account_number}</span>
                  </div>

                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between mt-1">
                    <div>
                      <span className="text-[9px] text-slate-500 uppercase block">Transaction ID (TrxID)</span>
                      <span className="text-xs font-black font-mono text-white tracking-wider">
                        {item.trx_id}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(item.trx_id)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                      title="Copy TrxID"
                    >
                      {copiedTrxId === item.trx_id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {item.sender_phone && (
                    <div className="text-[11px] text-slate-400">
                      Sender Phone: <strong className="text-slate-200 font-mono">{item.sender_phone}</strong>
                    </div>
                  )}
                </div>

                {/* Screenshot Verification Box */}
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-1.5 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">
                      Receipt Screenshot
                    </span>
                    {item.screenshot_url ? (
                      <div className="flex items-center space-x-3 mt-2">
                        <img
                          src={item.screenshot_url}
                          alt="Receipt Proof"
                          onClick={() => setPreviewImageUrl(item.screenshot_url || null)}
                          className="w-14 h-14 rounded-xl object-cover border border-slate-700 cursor-pointer hover:opacity-85 transition-opacity shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setPreviewImageUrl(item.screenshot_url || null)}
                            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center space-x-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Full Image</span>
                          </button>
                          <span className="text-[10px] text-slate-500 block mt-0.5">Click to inspect TrxID on screenshot</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 italic mt-2">No screenshot attached. Verify via TrxID directly in bKash, Nagad, or Rocket statement.</p>
                    )}
                  </div>

                  {/* Customer WhatsApp contact */}
                  {item.sender_phone && (
                    <div className="pt-1">
                      <a
                        href={`https://wa.me/${item.sender_phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                          `Hello, this is StreamPulse regarding your payment for ${item.plan_tier.toUpperCase()} Plan (TrxID: ${item.trx_id}).`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-emerald-400 hover:underline flex items-center space-x-1"
                      >
                        <MessageCircle className="w-3 h-3" />
                        <span>Chat with user on WhatsApp</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Rejection note if applicable */}
              {item.status === 'rejected' && item.rejection_reason && (
                <div className="p-3 rounded-xl bg-red-950/30 border border-red-800/40 text-xs text-red-300">
                  <strong>Rejection Note:</strong> {item.rejection_reason}
                </div>
              )}

              {/* Row 3: Admin Actions (Approve / Reject) */}
              {item.status === 'pending' && (
                <div className="pt-2 flex flex-wrap items-center justify-end gap-3 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => {
                      setRejectingPaymentId(item.id);
                      setRejectReason('');
                    }}
                    disabled={actionLoadingId === item.id}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-red-950/60 hover:text-red-400 text-xs font-semibold text-slate-300 border border-slate-700 hover:border-red-800 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50"
                  >
                    Reject
                  </button>

                  <button
                    type="button"
                    onClick={() => handleApprove(item)}
                    disabled={actionLoadingId === item.id}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-extrabold text-white shadow-lg shadow-emerald-950/60 hover:shadow-emerald-500/25 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {actionLoadingId === item.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Upgrading User &amp; Activating...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Approve &amp; Upgrade to {item.plan_tier.toUpperCase()} Plan</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Reject Modal */}
      {rejectingPaymentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h4 className="text-base font-bold text-white">Reject Payment Request</h4>
              <button
                onClick={() => setRejectingPaymentId(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Please specify the reason for rejecting this payment request. The user will be notified in-app.
            </p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Transaction ID not found in bKash statement, or amount paid was less than required."
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingPaymentId(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={actionLoadingId === rejectingPaymentId}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-bold text-white transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98]"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* High-Resolution Screenshot Lightbox Preview Modal */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 cursor-zoom-out"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-3xl p-3 shadow-2xl overflow-hidden flex flex-col cursor-default"
          >
            <div className="flex items-center justify-between p-3 border-b border-slate-800">
              <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                <ImageIcon className="w-4 h-4 text-emerald-400" />
                <span>Payment Receipt Screenshot</span>
              </span>
              <button
                onClick={() => setPreviewImageUrl(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2 overflow-auto flex items-center justify-center max-h-[75vh]">
              <img
                src={previewImageUrl}
                alt="Payment proof high-res"
                className="max-h-[72vh] w-auto rounded-xl object-contain border border-slate-800"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
