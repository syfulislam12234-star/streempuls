import React, { useState, useEffect } from 'react';
import {
  Gift,
  Copy,
  Check,
  Sparkles,
  Zap,
  Lock,
  ArrowRight,
  TrendingUp,
  Users,
  Percent,
  Coins,
  Share2,
  ExternalLink,
  AlertCircle,
  X,
  Loader2,
  RefreshCw,
  PlusCircle,
  ShieldCheck,
  CheckCircle2,
  Wallet,
  Clock,
  ArrowDownToLine,
  Building,
  Smartphone,
} from 'lucide-react';
import {
  apiClient,
  UserProfile,
  UserPromoCode,
  UserReferralSummary,
  WithdrawalRequest,
} from '../services/apiClient';
import { WithdrawalModal } from './WithdrawalModal';
import { ReferralGrowthChart } from './ReferralGrowthChart';

interface UserReferralPortalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onOpenPlanModal?: () => void;
  onUserUpdated?: (user: UserProfile) => void;
}

export const UserReferralPortal: React.FC<UserReferralPortalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onOpenPlanModal,
  onUserUpdated,
}) => {
  const [summary, setSummary] = useState<UserReferralSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Withdrawal State
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [isWithdrawalModalOpen, setIsWithdrawalModalOpen] = useState<boolean>(false);

  const isStarterFree =
    currentUser.subscription_tier === 'free' ||
    currentUser.subscription_status !== 'active';

  const availableBalance = currentUser.reward_credits_bdt ?? summary?.reward_credits_bdt ?? 0;

  const loadReferralData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [data, userWithdrawals] = await Promise.all([
        apiClient.getUserPromoCodes(currentUser.id),
        apiClient.getUserWithdrawals(currentUser.id),
      ]);
      setSummary(data);
      setWithdrawals(userWithdrawals);
    } catch (err: any) {
      console.warn('Failed to load referral data:', err);
      // Fallback state if server returns error or user is free
      setSummary({
        user_id: currentUser.id,
        user_email: currentUser.email,
        user_tier: currentUser.subscription_tier,
        subscription_status: currentUser.subscription_status,
        can_generate_codes: !isStarterFree,
        tier_restriction_reason: isStarterFree
          ? 'Starter Free tier is restricted from generating referral promo codes. Upgrade to Creator Pro or Ultra to unlock unique promo code generation, 15% audience discounts, and cash referral rewards!'
          : undefined,
        total_referral_earnings_bdt: 0,
        reward_credits_bdt: currentUser.reward_credits_bdt || 0,
        total_referral_uses: 0,
        active_codes_count: 0,
        promo_codes: [],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleWithdrawalSuccess = (newWithdrawal: WithdrawalRequest, newBalance: number) => {
    setWithdrawals((prev) => [newWithdrawal, ...prev]);
    setSuccessMessage(
      `Payout request of ৳${newWithdrawal.amount_bdt.toLocaleString()} BDT via ${newWithdrawal.payment_method.toUpperCase()} submitted! Available balance updated to ৳${newBalance.toLocaleString()} BDT.`
    );
    if (summary) {
      setSummary({
        ...summary,
        reward_credits_bdt: newBalance,
      });
    }
    if (onUserUpdated) {
      onUserUpdated({
        ...currentUser,
        reward_credits_bdt: newBalance,
      });
    }
    loadReferralData();
  };

  useEffect(() => {
    if (isOpen) {
      loadReferralData();
    }
  }, [isOpen, currentUser.id, currentUser.subscription_tier]);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleCopyLink = (code: string) => {
    const origin = window.location.origin;
    const link = `${origin}/plans?ref=${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(code);
    setTimeout(() => setCopiedLink(null), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl my-8 text-slate-100 max-h-[92vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900/95 backdrop-blur-sm z-20">
          <div className="flex items-center space-x-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-500/20 to-amber-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
              <Gift className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Referral Earning &amp; Promo Code Hub
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  Affiliate Program
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Share your promo codes with creators. Your audience gets 15% discount, and you earn up to 600 BDT cash reward per subscriber!
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 flex-1">
          {/* Messages */}
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-red-950/80 border border-red-800 text-red-200 text-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-400 hover:text-white font-bold ml-2 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {successMessage && (
            <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{successMessage}</span>
              </div>
              <button
                onClick={() => setSuccessMessage(null)}
                className="text-emerald-400 hover:text-white font-bold ml-2 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Tier Restriction Warning Banner if user is on Starter Free */}
          {isStarterFree && (
            <div className="p-5 rounded-3xl bg-gradient-to-r from-amber-950/60 via-slate-900 to-amber-950/40 border border-amber-500/50 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ring-1 ring-amber-500/20">
              <div className="flex items-start sm:items-center space-x-3.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span>Creator Tier Upgrade Required</span>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-700/60 font-semibold">
                      Current: {currentUser.subscription_tier.toUpperCase()}
                    </span>
                  </h4>
                  <p className="text-xs text-amber-200/80 mt-1 max-w-xl">
                    Promo code creation and referral cash rewards are reserved for <strong>Creator Pro</strong> and <strong>Ultra</strong> plan members. Upgrade today to generate branded promo codes and earn 300 to 600 BDT on every checkout!
                  </p>
                </div>
              </div>
              {onOpenPlanModal && (
                <button
                  onClick={() => {
                    onClose();
                    onOpenPlanModal();
                  }}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-xs font-bold text-white shadow-lg shadow-red-950/60 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center space-x-1.5 shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Upgrade to Creator Pro</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Summary Stats Overview & Withdrawable Balance */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Withdrawable Balance Card with Withdraw Earnings Action */}
            <div className="sm:col-span-2 p-5 rounded-3xl bg-gradient-to-br from-amber-950/40 via-slate-900 to-emerald-950/30 border border-amber-500/40 shadow-xl flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-bold text-amber-300">
                  <Wallet className="w-4 h-4 text-amber-400" />
                  <span>Available Withdrawable Balance</span>
                </div>
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-600/40 font-semibold">
                  Min Payout: 500 BDT
                </span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3">
                <div>
                  <div className="text-2xl sm:text-3xl font-black text-white font-mono">
                    ৳ {availableBalance.toLocaleString()}{' '}
                    <span className="text-xs font-bold text-amber-400">BDT</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {availableBalance >= 500
                      ? 'Funds ready for payout to bKash, Nagad, Rocket, or Bank.'
                      : 'Earn at least 500 BDT in referral commissions to request payout.'}
                  </p>
                </div>
                <button
                  onClick={() => setIsWithdrawalModalOpen(true)}
                  disabled={isStarterFree || availableBalance < 500}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-500 hover:to-emerald-500 text-xs font-bold text-white shadow-lg shadow-amber-950/50 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center justify-center space-x-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>Withdraw Earnings</span>
                </button>
              </div>
            </div>

            {/* 2. Total Lifetime Earned */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Total Lifetime</span>
                <Coins className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-black text-white font-mono">
                  ৳ {(summary?.total_referral_earnings_bdt || 0).toLocaleString()}
                </div>
                <p className="text-[10px] text-emerald-400 mt-0.5">Paid Referral Credits</p>
              </div>
            </div>

            {/* 3. Total Uses & Conversions */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-1 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Total Uses</span>
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-black text-white font-mono">
                  {summary?.total_referral_uses || 0}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Subscribers Referred</p>
              </div>
            </div>
          </div>

          {/* Referral Growth Trends Data Visualization (Recharts) */}
          <ReferralGrowthChart
            data={summary?.daily_growth_30d}
            isStarterFree={isStarterFree}
            totalEarningsBdt={summary?.total_referral_earnings_bdt || 0}
            totalSignups={summary?.total_referral_uses || 0}
            onOpenPlanModal={() => {
              onClose();
              if (onOpenPlanModal) onOpenPlanModal();
            }}
          />

          {/* Single Permanent Referral Promo Code Showcase (Clean & Hassle-Free) */}
          {(() => {
            const rawUsername = currentUser.full_name
              ? currentUser.full_name.trim().split(' ')[0]
              : currentUser.email.split('@')[0];
            const cleanUsername = rawUsername.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'CREATOR';
            const fallbackCode = currentUser.referral_code || `PULSE-${cleanUsername}`;

            const primaryPromo = (summary?.promo_codes && summary.promo_codes[0]) || {
              id: `promo-${currentUser.id}`,
              code: fallbackCode,
              creator_id: currentUser.id,
              creator_email: currentUser.email,
              creator_name: currentUser.full_name || currentUser.email.split('@')[0],
              creator_tier: currentUser.subscription_tier,
              discount_percent: currentUser.subscription_tier === 'business' ? 20 : 15,
              reward_bdt_per_use: currentUser.subscription_tier === 'business' ? 600 : 300,
              usage_count: summary?.total_referral_uses || 0,
              max_uses: 500,
              is_active: true,
              total_earned_bdt: summary?.total_referral_earnings_bdt || 0,
              referral_link: `${window.location.origin}/plans?ref=${encodeURIComponent(fallbackCode)}`,
              created_at: currentUser.created_at,
            };

            const directLink = `${window.location.origin}/plans?ref=${encodeURIComponent(primaryPromo.code)}`;
            const isCodeCopied = copiedCode === primaryPromo.code;
            const isLinkCopied = copiedLink === primaryPromo.code;

            const shareMessage = `Stream 24/7 like a pro with StreamPulse! Use my official promo code "${primaryPromo.code}" for an instant ${primaryPromo.discount_percent}% discount: ${directLink}`;
            const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessage)}`;
            const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(directLink)}&text=${encodeURIComponent(`Get ${primaryPromo.discount_percent}% OFF StreamPulse with code: ${primaryPromo.code}`)}`;
            const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(directLink)}`;

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Gift className="w-4 h-4 text-amber-400" />
                    <h4 className="text-sm font-bold text-white tracking-tight">
                      Your Permanent Referral Promo Code
                    </h4>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    Official &amp; Permanent
                  </span>
                </div>

                <div className="p-6 sm:p-7 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-amber-500/30 shadow-2xl relative overflow-hidden space-y-6">
                  {/* Decorative ambient gradient */}
                  <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

                  {/* Main Promo Code Highlight */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90 block">
                        Your Unique Creator Promo Code
                      </span>
                      <div className="flex items-center space-x-3">
                        <span className="px-4 py-2 rounded-2xl font-mono text-xl sm:text-2xl font-black tracking-widest bg-slate-950 text-amber-300 border border-amber-500/50 shadow-inner select-all">
                          {primaryPromo.code}
                        </span>
                        <button
                          onClick={() => handleCopyCode(primaryPromo.code)}
                          className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-white border border-amber-500/30 transition-all font-semibold text-xs flex items-center space-x-1.5 cursor-pointer shadow-sm active:scale-95"
                          title="Copy Promo Code"
                        >
                          {isCodeCopied ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-400" />
                              <span className="text-emerald-400 font-bold">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span>Copy Code</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Benefit Pills */}
                    <div className="flex items-center gap-2 self-start sm:self-center">
                      <div className="px-3.5 py-2 rounded-2xl bg-emerald-950/50 border border-emerald-500/30 text-center">
                        <span className="text-[10px] text-emerald-400/80 block font-semibold">Buyer Discount</span>
                        <span className="text-xs sm:text-sm font-black text-emerald-300 font-mono">
                          {primaryPromo.discount_percent}% OFF
                        </span>
                      </div>
                      <div className="px-3.5 py-2 rounded-2xl bg-amber-950/50 border border-amber-500/30 text-center">
                        <span className="text-[10px] text-amber-400/80 block font-semibold">Your Commission</span>
                        <span className="text-xs sm:text-sm font-black text-amber-300 font-mono">
                          ৳ {primaryPromo.reward_bdt_per_use} <span className="text-[10px]">/sub</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 1-Click Direct Referral Link Box */}
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-semibold flex items-center space-x-1.5">
                        <Share2 className="w-3.5 h-3.5 text-amber-400" />
                        <span>Direct 1-Click Referral Link (Auto-applies code at checkout):</span>
                      </span>
                      <button
                        onClick={() => handleCopyLink(primaryPromo.code)}
                        className="text-xs text-amber-400 hover:text-amber-300 font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                      >
                        {isLinkCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied to Clipboard!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Full Link</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-3.5 py-2.5 bg-slate-900 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 truncate select-all">
                        {directLink}
                      </div>
                      <button
                        onClick={() => handleCopyLink(primaryPromo.code)}
                        className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-500 hover:to-emerald-500 text-white font-bold text-xs shrink-0 transition-all active:scale-95 cursor-pointer shadow-md shadow-amber-950/40 flex items-center space-x-1.5"
                      >
                        {isLinkCopied ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-300" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>1-Click Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Performance Summary & Quick Social Sharing */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
                    <div className="flex items-center space-x-4 font-mono">
                      <span>
                        Referred: <strong className="text-white">{primaryPromo.usage_count}</strong> subscribers
                      </span>
                      <span>&bull;</span>
                      <span>
                        Total Earned: <strong className="text-emerald-400">৳ {(primaryPromo.total_earned_bdt || 0).toLocaleString()} BDT</strong>
                      </span>
                      <span>&bull;</span>
                      <span className="text-slate-500">Lifetime Validity</span>
                    </div>

                    {/* Social Share Buttons */}
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] text-slate-500">Quick Share:</span>
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-emerald-400 border border-slate-700 transition-colors"
                      >
                        WhatsApp
                      </a>
                      <a
                        href={telegramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-sky-400 border border-slate-700 transition-colors"
                      >
                        Telegram
                      </a>
                      <a
                        href={facebookUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-blue-400 border border-slate-700 transition-colors"
                      >
                        Facebook
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Payout & Withdrawal History Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <h4 className="text-sm font-bold text-white">
                  Withdrawal History &amp; Payouts
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300">
                  {withdrawals.length}
                </span>
              </div>
              <button
                onClick={() => setIsWithdrawalModalOpen(true)}
                disabled={isStarterFree || availableBalance < 500}
                className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center space-x-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowDownToLine className="w-3.5 h-3.5" />
                <span>New Withdrawal</span>
              </button>
            </div>

            {withdrawals.length === 0 ? (
              <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-center space-y-1">
                <p className="text-xs text-slate-300 font-semibold">No Payout Requests Yet</p>
                <p className="text-[11px] text-slate-400">
                  Accumulate 500 BDT or more from affiliate referrals to request payouts to bKash, Nagad, Rocket, or Bank Transfer.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden divide-y divide-slate-800/80">
                {withdrawals.map((w) => {
                  const statusBadge =
                    w.status === 'approved' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40 uppercase">
                        Approved
                      </span>
                    ) : w.status === 'rejected' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-950 text-red-300 border border-red-500/40 uppercase">
                        Rejected
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500/40 uppercase flex items-center space-x-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <span>Pending</span>
                      </span>
                    );

                  return (
                    <div
                      key={w.id}
                      className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-900/40 transition-colors"
                    >
                      <div className="flex items-start sm:items-center space-x-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 shrink-0">
                          {w.payment_method === 'bank' ? (
                            <Building className="w-4 h-4 text-blue-400" />
                          ) : (
                            <Smartphone className="w-4 h-4 text-amber-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-white uppercase">
                              {w.payment_method}
                            </span>
                            <span className="text-[11px] font-mono text-slate-300">
                              {w.account_number}
                            </span>
                            {w.bank_name && (
                              <span className="text-[10px] text-slate-400">
                                ({w.bank_name})
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            {new Date(w.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })} &middot; ID: {w.id}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end space-x-3.5">
                        <span className="text-sm sm:text-base font-black font-mono text-white">
                          ৳ {w.amount_bdt.toLocaleString()}{' '}
                          <span className="text-xs font-semibold text-slate-400">BDT</span>
                        </span>
                        {statusBadge}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3-Step Program Explainer */}
          <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>How StreamPulse Referral Program Works</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-300">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1">
                <span className="w-5 h-5 rounded-full bg-red-600/20 text-red-400 font-bold flex items-center justify-center text-[10px]">1</span>
                <p className="font-bold text-white">Share Your Code</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Put your promo code in your YouTube live descriptions, video tutorials, or creator communities.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1">
                <span className="w-5 h-5 rounded-full bg-emerald-600/20 text-emerald-400 font-bold flex items-center justify-center text-[10px]">2</span>
                <p className="font-bold text-white">Buyers Get 15% OFF</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Subscribers enter your code at checkout and instantly save up to 1,800 BDT on their streaming plan.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800/80 space-y-1">
                <span className="w-5 h-5 rounded-full bg-amber-600/20 text-amber-400 font-bold flex items-center justify-center text-[10px]">3</span>
                <p className="font-bold text-white">You Earn Cash Credits</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Receive up to 600 BDT credited directly to your account balance for every verified activation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Withdrawal Request Modal */}
      <WithdrawalModal
        isOpen={isWithdrawalModalOpen}
        onClose={() => setIsWithdrawalModalOpen(false)}
        currentUser={currentUser}
        availableBalanceBdt={availableBalance}
        onWithdrawalSuccess={handleWithdrawalSuccess}
      />
    </div>
  );
};
