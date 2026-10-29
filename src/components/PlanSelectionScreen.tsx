import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Check,
  Zap,
  Lock,
  ArrowRight,
  Radio,
  Sparkles,
  CreditCard,
  Building2,
  Tv,
  Film,
  Clock,
  CheckCircle2,
  Loader2,
  UserPlus,
  RefreshCw,
  LogOut,
  MessageCircle,
  Gift,
} from 'lucide-react';
import { apiClient, UserProfile, SubscriptionTier, PaymentRequest } from '../services/apiClient';
import { LegalTermsModal } from './LegalTermsModal';
import { ManualPaymentModal } from './ManualPaymentModal';
import { useRealtimeSync, useConfigInvalidation } from '../context/RealtimeSyncContext';

interface PlanSelectionScreenProps {
  currentUser: UserProfile;
  onPlanActivated: (updatedUser: UserProfile) => void;
  onLogout: () => void;
  onClose?: () => void;
  onOpenLegal?: (tab?: 'terms' | 'privacy', sectionId?: string) => void;
}

export const PlanSelectionScreen: React.FC<PlanSelectionScreenProps> = ({
  currentUser,
  onPlanActivated,
  onLogout,
  onClose,
  onOpenLegal,
}) => {
  // Real-Time auto-sync & fail-safe background invalidation
  const { siteContent, paymentSettings } = useRealtimeSync();
  useConfigInvalidation(true, 'all');

  const [selectedPlanForPayment, setSelectedPlanForPayment] = useState<SubscriptionTier | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'bkash' | 'nagad' | 'rocket' | 'card'>('bkash');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localShowLegal, setLocalShowLegal] = useState(false);
  const [localInitialTab, setLocalInitialTab] = useState<'terms' | 'privacy'>('terms');
  const [localInitialSection, setLocalInitialSection] = useState<string | undefined>(undefined);
  const [urlReferralCode, setUrlReferralCode] = useState<string | null>(null);

  React.useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const ref = urlParams.get('ref') || urlParams.get('promo');
      if (ref) setUrlReferralCode(ref.toUpperCase());
    } catch {}
  }, []);

  // Autonomous payment requests tracking state
  const [myPaymentRequests, setMyPaymentRequests] = useState<PaymentRequest[]>([]);

  const fetchMyPayments = async () => {
    try {
      const list = await apiClient.getMyPaymentRequests(currentUser.id);
      setMyPaymentRequests(list);
    } catch (e) {}
  };

  React.useEffect(() => {
    fetchMyPayments();
  }, [currentUser]);

  const handleOpenLegalClick = (tab?: 'terms' | 'privacy', sectionId?: string) => {
    if (onOpenLegal) {
      onOpenLegal(tab, sectionId);
    } else {
      setLocalInitialTab(tab || 'terms');
      setLocalInitialSection(sectionId);
      setLocalShowLegal(true);
    }
  };

  // Live countdown ticker state (1-second interval)
  const [now, setNow] = useState<number>(Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. Activate Free Trial
  const handleSelectFreeTrial = async () => {
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const updated = await apiClient.selectPlan({
        userId: currentUser.id,
        planTier: 'free',
      });
      onPlanActivated(updated);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to activate Free Trial. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Open Paid Checkout (Direct manual payment modal)
  const handleOpenPaidCheckout = (tier: SubscriptionTier) => {
    setSelectedPlanForPayment(tier);
    setErrorMsg(null);
  };

  // 3. Complete Checkout & Activate Paid Plan
  const handleCompletePayment = async () => {
    if (!selectedPlanForPayment) return;
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const { user: updated } = await apiClient.checkoutPlan({
        userId: currentUser.id,
        planTier: selectedPlanForPayment,
        paymentMethod,
      });
      setSelectedPlanForPayment(null);
      onPlanActivated(updated);
    } catch (err: any) {
      setErrorMsg(err.message || 'Payment processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex flex-col justify-between py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Referral Partner Discount Banner */}
      {urlReferralCode && (
        <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-amber-950/60 via-slate-900 to-amber-950/40 border border-amber-500/40 flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-3 text-xs text-amber-200">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Gift className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-white">
                Partner Referral Discount Activated: <span className="font-mono text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded-lg border border-amber-500/30">{urlReferralCode}</span>
              </p>
              <p className="text-slate-300 text-[11px] mt-0.5">
                Up to 15% discount will be applied automatically to your Creator Pro or Ultra plan at checkout.
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-block px-3 py-1 rounded-xl bg-amber-500/20 text-amber-300 font-bold text-xs uppercase border border-amber-500/30 shrink-0">
            Special Offer
          </span>
        </div>
      )}

      {/* Account Guard / Plan Management Banner */}
      <div
        className={`mb-8 p-4 sm:p-5 rounded-3xl border shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          currentUser.subscription_status === 'active'
            ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-200'
            : 'bg-amber-950/40 border-amber-600/30 text-amber-200'
        }`}
      >
        <div className="flex items-start sm:items-center space-x-3.5">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
              currentUser.subscription_status === 'active'
                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/20 border-amber-500/30 text-amber-400'
            }`}
          >
            {currentUser.subscription_status === 'active' ? (
              <Zap className="w-5 h-5" />
            ) : (
              <Lock className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                {currentUser.subscription_status === 'active'
                  ? `Active Plan: ${currentUser.subscription_tier.toUpperCase()}`
                  : 'Account Guard: Subscription Required'}
              </h3>
              <span
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-semibold border ${
                  currentUser.subscription_status === 'active'
                    ? 'bg-emerald-950 text-emerald-400 border-emerald-800/60'
                    : 'bg-red-950 text-red-400 border-red-800/60'
                }`}
              >
                Status: {currentUser.subscription_status}
              </span>
            </div>
            <p
              className={`text-xs mt-0.5 ${
                currentUser.subscription_status === 'active'
                  ? 'text-emerald-300/80'
                  : 'text-amber-300/80'
              }`}
            >
              {currentUser.subscription_status === 'active' ? (
                <>
                  Logged in as <span className="font-semibold text-white">{currentUser.email}</span>. You can switch or upgrade your broadcasting limits below anytime.
                </>
              ) : (
                <>
                  Welcome, <span className="font-semibold text-white">{currentUser.email}</span>! Please select an active plan below to unlock your 24/7 RTMP streaming studio.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-end sm:self-center">
          {currentUser.subscription_status === 'active' && onClose && (
            <button
              onClick={onClose}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-emerald-500/20 cursor-pointer"
            >
              <span>Return to Studio</span>
            </button>
          )}
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Instant Gateway Verification</span>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-red-950/60 text-xs text-slate-400 hover:text-red-300 border border-slate-800 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer"
            title="Sign out or switch user"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Switch</span>
          </button>
        </div>
      </div>

      {/* User's Pending Payment Request Status Banner with 1-Hour Live Countdown */}
      {(() => {
        const pendingPayment = myPaymentRequests.find((p) => p.status === 'pending');
        if (!pendingPayment) return null;

        const createdMs = pendingPayment.created_at ? new Date(pendingPayment.created_at).getTime() : now;
        // 60-minute review window
        const deadlineMs = createdMs + 60 * 60 * 1000;
        const remainingSeconds = Math.max(0, Math.floor((deadlineMs - now) / 1000));
        const mins = Math.floor(remainingSeconds / 60);
        const secs = remainingSeconds % 60;
        const countdownStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        return (
          <div className="mb-8 p-5 rounded-3xl bg-gradient-to-r from-amber-950/60 via-slate-900 to-amber-950/50 border border-amber-500/50 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-5 ring-1 ring-amber-500/20">
            <div className="flex items-start sm:items-center space-x-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0 shadow-inner">
                <Clock className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm sm:text-base font-extrabold text-white">Manual Payment Under Review</h4>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30">
                    {pendingPayment.sender_phone ? `Sender: ${pendingPayment.sender_phone}` : `Ref: ${pendingPayment.trx_id}`}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30 capitalize">
                    {pendingPayment.payment_method}
                  </span>
                </div>
                <p className="text-xs text-amber-200/90 leading-relaxed">
                  Your manual payment of <strong className="text-white font-mono">{pendingPayment.amount_bdt.toLocaleString()} BDT</strong> for <strong className="text-white uppercase">{pendingPayment.plan_tier} Plan</strong> is in queue. An administrator is actively verifying your receipt. Your account and 24/7 studio will automatically unlock within this timeframe once approved.
                </p>
              </div>
            </div>

            {/* Live 60-Minute Countdown Clock & WhatsApp Support */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full md:w-auto shrink-0">
              <div className="px-4 py-2 rounded-2xl bg-slate-950 border border-amber-500/40 text-center shadow-inner">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
                  Estimated Remaining
                </span>
                <span className="text-lg font-black font-mono text-white tracking-widest">
                  {countdownStr}
                </span>
              </div>
              <a
                href={`https://wa.me/8801712345678?text=${encodeURIComponent(`Hello StreamPulse Support, checking on my manual payment status for ${pendingPayment.plan_tier.toUpperCase()} Plan (${pendingPayment.sender_phone ? `Sender: ${pendingPayment.sender_phone}` : `Ref: ${pendingPayment.trx_id}`})`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-md shadow-emerald-950/60"
              >
                <MessageCircle className="w-4 h-4" />
                <span>WhatsApp Support</span>
              </a>
            </div>
          </div>
        );
      })()}

      {errorMsg && (
        <div className="mb-6 p-4 rounded-2xl bg-red-950/80 border border-red-800 text-red-200 text-xs flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 font-bold ml-2">✕</button>
        </div>
      )}

      {/* Plans Header */}
      <div className="text-center max-w-3xl mx-auto space-y-2 mb-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          Subscription Plans &amp; Quotas
        </h2>
        <p className="text-sm text-slate-400">
          Select a subscription tier to configure your live broadcast channels, video storage, and streaming hours.
        </p>
      </div>

      {/* 4 Required Subscription Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {/* 1. FREE PLAN */}
        <div className="relative rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 p-6 flex flex-col justify-between transition-all duration-200 shadow-xl">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold tracking-wider uppercase text-slate-400">
                Free Plan
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                3 Days Trial
              </span>
            </div>

            <div>
              <div className="flex items-baseline space-x-1">
                <span className="text-3xl font-extrabold text-white">0</span>
                <span className="text-sm font-semibold text-slate-400">BDT</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">3 days duration &middot; 10-hour total limit</p>
            </div>

            <div className="pt-4 border-t border-slate-800 space-y-3 text-xs text-slate-300">
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>1 Channel</strong> live broadcast</span>
              </div>
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>1 Video</strong> looped storage</span>
              </div>
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                <span><strong>10-hour total</strong> limit (3 days)</span>
              </div>
              <div className="flex items-start space-x-2 text-slate-400 text-[11px] bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                <Radio className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>Automated &ldquo;Power of StreamPulse&rdquo; watermark &amp; forced app link in description</span>
              </div>
            </div>
          </div>

          <div className="pt-6">
            <button
              onClick={handleSelectFreeTrial}
              disabled={isProcessing}
              className="w-full py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-200 text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md hover:shadow-lg hover:shadow-slate-700/30 cursor-pointer flex items-center justify-center space-x-2"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>Select Free Trial</span>
            </button>
          </div>
        </div>

        {/* 2. BASIC PLAN */}
        <div className="relative rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 p-6 flex flex-col justify-between transition-all duration-200 shadow-xl">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold tracking-wider uppercase text-blue-400">
                Basic Plan
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                30 Days
              </span>
            </div>

            <div>
              <div className="flex items-baseline space-x-1">
                <span className="text-3xl font-extrabold text-white">1,200</span>
                <span className="text-sm font-semibold text-slate-400">BDT</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Single channel continuous stream</p>
            </div>

            <div className="pt-4 border-t border-slate-800 space-y-3 text-xs text-slate-300">
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>1 Channel</strong> live broadcast</span>
              </div>
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>1 Video</strong> looped storage</span>
              </div>
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                <span><strong>Non-stop streaming</strong> (24/7 continuous)</span>
              </div>
              <div className="flex items-center space-x-2 text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Brand-Free (No Watermark)</span>
              </div>
            </div>
          </div>

          <div className="pt-6">
            <button
              onClick={() => handleOpenPaidCheckout('basic')}
              disabled={isProcessing}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-blue-950/60 hover:shadow-lg hover:shadow-blue-500/25 cursor-pointer flex items-center justify-center space-x-1.5"
            >
              <span>Pay 1,200 BDT</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 3. PRO PLAN (Recommended) */}
        <div className="relative rounded-3xl bg-slate-900 border-2 border-red-500 p-6 flex flex-col justify-between transition-all duration-200 shadow-2xl shadow-red-950/40 ring-4 ring-red-500/10">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-red-600 to-rose-600 text-white text-[10px] font-extrabold uppercase tracking-wider shadow-sm">
            Most Popular
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold tracking-wider uppercase text-red-400">
                Pro Plan
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-300 border border-red-500/20">
                30 Days
              </span>
            </div>

            <div>
              <div className="flex items-baseline space-x-1">
                <span className="text-3xl font-extrabold text-white">4,000</span>
                <span className="text-sm font-semibold text-slate-400">BDT</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Multi-channel 24/7 broadcasting</p>
            </div>

            <div className="pt-4 border-t border-slate-800 space-y-3 text-xs text-slate-300">
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>2 Channels</strong> concurrent streams</span>
              </div>
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>2 Videos</strong> stored loops</span>
              </div>
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                <span><strong>Non-stop streaming</strong> (24/7 continuous)</span>
              </div>
              <div className="flex items-center space-x-2 text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Brand-Free (No Watermark)</span>
              </div>
            </div>
          </div>

          <div className="pt-6">
            <button
              onClick={() => handleOpenPaidCheckout('pro')}
              disabled={isProcessing}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-extrabold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-red-950/80 hover:shadow-xl hover:shadow-red-500/30 cursor-pointer flex items-center justify-center space-x-1.5"
            >
              <span>Pay 4,000 BDT</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 4. BUSINESS PLAN */}
        <div className="relative rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 p-6 flex flex-col justify-between transition-all duration-200 shadow-xl">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold tracking-wider uppercase text-purple-400">
                Business Plan
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/20">
                30 Days
              </span>
            </div>

            <div>
              <div className="flex items-baseline space-x-1">
                <span className="text-3xl font-extrabold text-white">12,000</span>
                <span className="text-sm font-semibold text-slate-400">BDT</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">High-capacity continuous studio</p>
            </div>

            <div className="pt-4 border-t border-slate-800 space-y-3 text-xs text-slate-300">
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>4 Channels</strong> concurrent live</span>
              </div>
              <div className="flex items-center space-x-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>4 Videos</strong> stored loops</span>
              </div>
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                <span><strong>Non-stop streaming</strong> (24/7 continuous)</span>
              </div>
              <div className="flex items-center space-x-2 text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Brand-Free (No Watermark)</span>
              </div>
            </div>
          </div>

          <div className="pt-6">
            <button
              onClick={() => handleOpenPaidCheckout('business')}
              disabled={isProcessing}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-purple-950/60 hover:shadow-lg hover:shadow-purple-500/25 cursor-pointer flex items-center justify-center space-x-1.5"
            >
              <span>Pay 12,000 BDT</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* Manual Payment Submission Modal (bKash, Nagad & Rocket)              */}
      {/* ==================================================================== */}
      {selectedPlanForPayment && (
        <ManualPaymentModal
          isOpen={!!selectedPlanForPayment}
          onClose={() => setSelectedPlanForPayment(null)}
          currentUser={currentUser}
          planTier={selectedPlanForPayment}
          onPlanActivated={onPlanActivated}
          onPaymentSubmitted={(_payment) => {
            fetchMyPayments();
          }}
          onOpenLegal={onOpenLegal}
        />
      )}


      {/* Local Legal Terms Modal Fallback */}
      <LegalTermsModal
        isOpen={localShowLegal}
        onClose={() => setLocalShowLegal(false)}
        initialTab={localInitialTab}
        initialSectionId={localInitialSection}
      />
    </div>
  );
};
