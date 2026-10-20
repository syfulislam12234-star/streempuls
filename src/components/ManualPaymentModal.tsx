import React, { useState, useRef, useEffect } from 'react';
import {
  CreditCard,
  X,
  Copy,
  Check,
  Upload,
  MessageCircle,
  HelpCircle,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ImageIcon,
  Trash2,
  ExternalLink,
  Smartphone,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { apiClient, UserProfile, SubscriptionTier, PaymentRequest } from '../services/apiClient';
import { useRealtimeSync, useConfigInvalidation } from '../context/RealtimeSyncContext';

interface ManualPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  planTier: SubscriptionTier;
  onPaymentSubmitted: (payment: PaymentRequest) => void;
  onPlanActivated?: (user: UserProfile) => void;
  onOpenLegal?: (tab: 'terms' | 'privacy', sectionId?: string) => void;
}

export const ManualPaymentModal: React.FC<ManualPaymentModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  planTier,
  onPaymentSubmitted,
  onPlanActivated,
  onOpenLegal,
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'bkash' | 'nagad' | 'rocket'>('bkash');
  const [accountType, setAccountType] = useState<'personal' | 'merchant'>('personal');
  const [trxId, setTrxId] = useState<string>('');
  const [senderPhone, setSenderPhone] = useState<string>('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);

  // Status State
  const [copiedNumber, setCopiedNumber] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedPayment, setSubmittedPayment] = useState<PaymentRequest | null>(null);
  const [activatedUser, setActivatedUser] = useState<UserProfile | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(3600); // 60-minute countdown

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 60-minute countdown timer effect upon submission
  useEffect(() => {
    if (!submittedPayment) return;
    setCountdownSeconds(3600);
    const interval = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [submittedPayment]);

  // Real-Time auto-sync & fail-safe background invalidation on modal open
  const { paymentSettings: realtimePaymentSettings } = useRealtimeSync();
  useConfigInvalidation(isOpen, 'payment');
  const paymentSettings = realtimePaymentSettings;

  if (!isOpen) return null;

  // Account details (dynamic from backend settings)
  const BKASH_PERSONAL = paymentSettings.bkash_personal;
  const BKASH_MERCHANT = paymentSettings.bkash_merchant;
  const NAGAD_PERSONAL = paymentSettings.nagad_personal;
  const NAGAD_MERCHANT = paymentSettings.nagad_merchant;
  const ROCKET_PERSONAL = paymentSettings.rocket_personal;
  const ROCKET_MERCHANT = paymentSettings.rocket_merchant;
  const WHATSAPP_NUMBER = paymentSettings.whatsapp_number;
  const WHATSAPP_DISPLAY = WHATSAPP_NUMBER;

  const basePriceBdt = planTier === 'basic' ? 1200 : planTier === 'pro' ? 4000 : 12000;
  const finalAmountToPay = basePriceBdt;

  const currentAccountNumber =
    paymentMethod === 'bkash'
      ? accountType === 'personal'
        ? BKASH_PERSONAL
        : BKASH_MERCHANT
      : paymentMethod === 'nagad'
      ? accountType === 'personal'
        ? NAGAD_PERSONAL
        : NAGAD_MERCHANT
      : accountType === 'personal'
      ? ROCKET_PERSONAL
      : ROCKET_MERCHANT;

  const rawCopyNumber = currentAccountNumber.replace(/[^0-9]/g, '');

  const handleCopyNumber = (num: string) => {
    navigator.clipboard.writeText(num);
    setCopiedNumber(num);
    setTimeout(() => setCopiedNumber(null), 2500);
  };

  const formatCountdown = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleFileSelect = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select an image file (PNG, JPG, JPEG, WebP)');
      return;
    }
    setScreenshotFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshotPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    setErrorMessage(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanTrx = trxId.trim().toUpperCase();
    if (!cleanTrx) {
      setErrorMessage('Please enter your Transaction ID (TrxID) received from your bKash, Nagad, or Rocket SMS.');
      return;
    }

    if (cleanTrx.length < 5) {
      setErrorMessage('Transaction ID appears too short. Please verify the code from your payment receipt.');
      return;
    }

    setIsSubmitting(true);
    try {
      let uploadedScreenshotUrl = screenshotPreview || undefined;

      // If we have a file, upload to server storage endpoint
      if (screenshotFile) {
        try {
          const remoteUrl = await apiClient.uploadPaymentScreenshot(screenshotFile);
          if (remoteUrl) {
            uploadedScreenshotUrl = remoteUrl;
          }
        } catch (uploadErr) {
          // If remote upload endpoint fails, fallback to the base64 preview already captured
          console.warn('Screenshot remote upload fallback to base64 preview', uploadErr);
        }
      }

      const res: any = await apiClient.submitManualPayment({
        userId: currentUser.id,
        planTier: planTier as any,
        amountBdt: finalAmountToPay,
        paymentMethod,
        accountNumber: currentAccountNumber,
        senderPhone: senderPhone.trim() || undefined,
        trxId: cleanTrx,
        screenshotUrl: uploadedScreenshotUrl,
      });

      setSubmittedPayment(res.paymentRequest);
      if (res.updatedUser) {
        setActivatedUser(res.updatedUser);
      }
      onPaymentSubmitted(res.paymentRequest);
      if (res.autoActivated && res.updatedUser && onPlanActivated) {
        // Automatically sync updated user session
        onPlanActivated(res.updatedUser);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit payment request. Please check details or reach out on WhatsApp.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const whatsappMessage = encodeURIComponent(
    `Hello StreamPulse Support,\n\nI have submitted a manual payment for StreamPulse 24/7 Live:\n- Plan: ${planTier.toUpperCase()} Plan (${finalAmountToPay} BDT)\n- Payment Method: ${paymentMethod.toUpperCase()} (${accountType})\n- TrxID: ${trxId.trim() || '[Entering TrxID]'}\n- User Email: ${currentUser.email}\n\nPlease verify and activate my subscription.`
  );
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER.replace(/[^0-9]/g, '')}?text=${whatsappMessage}`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 p-5 sm:p-7 space-y-6 shadow-2xl my-8 text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Manual Payment &amp; Approval
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                  {planTier} Plan
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-white">
                bKash, Nagad &amp; Rocket Subscription Checkout
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submittedPayment ? (
          /* ==================================================================== */
          /* AUTONOMOUS SUCCESS / INSTANT ACTIVATION CONFIRMATION VIEW             */
          /* ==================================================================== */
          <div className="space-y-6 py-2 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-950/50">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h4 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {submittedPayment.status === 'approved' || activatedUser
                  ? 'Plan Activated Successfully'
                  : 'Payment Submitted for Verification'}
              </h4>
              <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
                {submittedPayment.status === 'approved' || activatedUser ? (
                  <>
                    Transaction confirmed. Your{' '}
                    <strong className="text-white uppercase">{planTier} Plan</strong> quotas and multi-destination streaming are now active.
                  </>
                ) : (
                  <>
                    Your transaction details for the <strong className="text-white uppercase">{planTier} Plan</strong> have been recorded and are being verified.
                  </>
                )}
              </p>
            </div>

            {/* Verification Status Banner */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1 max-w-md mx-auto">
              <div className="flex items-center justify-center space-x-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold tracking-wide">
                  {submittedPayment.status === 'approved' || activatedUser
                    ? 'Subscription Active'
                    : 'Verification In Progress'}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Studio quotas updated &middot; Ready for live broadcasting
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-left space-y-2.5 text-xs max-w-md mx-auto">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800/80">
                <span className="text-slate-400">Status:</span>
                <span className="px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>
                    {submittedPayment.status === 'approved' || activatedUser
                      ? 'Active & Unlocked'
                      : 'Auto-Syncing'}
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Transaction ID (TrxID):</span>
                <span className="text-white font-mono font-bold">{submittedPayment.trx_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount:</span>
                <span className="text-emerald-400 font-bold font-mono">{submittedPayment.amount_bdt.toLocaleString()} BDT</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payment Channel:</span>
                <span className="text-slate-200 capitalize font-medium">{submittedPayment.payment_method}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Verification:</span>
                <span className="text-slate-200 font-medium">Automated Verification</span>
              </div>
            </div>

            {/* Direct Action Buttons */}
            <div className="pt-2 max-w-md mx-auto space-y-3">
              <button
                type="button"
                onClick={() => {
                  if (activatedUser && onPlanActivated) {
                    onPlanActivated(activatedUser);
                  }
                  onClose();
                }}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-red-950/60 cursor-pointer"
              >
                <span>Launch 24/7 Live Studio</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold flex items-center justify-center space-x-2 transition-colors cursor-pointer"
              >
                <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>WhatsApp Instant Support</span>
                <ExternalLink className="w-3 h-3 opacity-70" />
              </a>
            </div>
          </div>
        ) : (
          /* ==================================================================== */
          /* FORM VIEW: INSTRUCTIONS, ACCOUNTS, TRXID & SCREENSHOT                */
          /* ==================================================================== */
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 1. Clean Price Summary (Streamlined without Promo Code) */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Plan Selected:</span>
                <span className="text-white font-extrabold uppercase">{planTier} Plan (30 Days)</span>
              </div>
              <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-sm">
                <span className="text-slate-200 font-bold">Total Payable:</span>
                <div className="text-right">
                  <span className="text-emerald-400 font-black text-lg font-mono">
                    {finalAmountToPay.toLocaleString()} BDT
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Payment Method Selector (bKash vs Nagad vs Rocket) */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 block">
                1. Select Payment Channel:
              </label>
              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('bkash')}
                  className={`p-3 sm:p-3.5 rounded-2xl border text-left cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
                    paymentMethod === 'bkash'
                      ? 'bg-pink-950/40 border-pink-500 ring-2 ring-pink-500/30 text-white shadow-lg shadow-pink-950/50 font-bold'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-pink-400">bKash</span>
                    {paymentMethod === 'bkash' && (
                      <span className="w-2 h-2 rounded-full bg-pink-400" />
                    )}
                  </div>
                  <span className="text-[10px] sm:text-[11px] text-slate-300 block mt-1">Send Money / Pay</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('nagad')}
                  className={`p-3 sm:p-3.5 rounded-2xl border text-left cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
                    paymentMethod === 'nagad'
                      ? 'bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/30 text-white shadow-lg shadow-amber-950/50 font-bold'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400">Nagad</span>
                    {paymentMethod === 'nagad' && (
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                    )}
                  </div>
                  <span className="text-[10px] sm:text-[11px] text-slate-300 block mt-1">Send Money / Pay</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('rocket')}
                  className={`p-3 sm:p-3.5 rounded-2xl border text-left cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] ${
                    paymentMethod === 'rocket'
                      ? 'bg-purple-950/40 border-purple-500 ring-2 ring-purple-500/30 text-white shadow-lg shadow-purple-950/50 font-bold'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-400">Rocket</span>
                    {paymentMethod === 'rocket' && (
                      <span className="w-2 h-2 rounded-full bg-purple-400" />
                    )}
                  </div>
                  <span className="text-[10px] sm:text-[11px] text-slate-300 block mt-1">Send Money / Pay</span>
                </button>
              </div>
            </div>

            {/* 3. Account Type (Personal vs Merchant) & Official Numbers */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300">
                  2. StreamPulse Official Account Details:
                </label>
                <div className="flex items-center space-x-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setAccountType('personal')}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      accountType === 'personal'
                        ? 'bg-slate-800 text-white border border-slate-700'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Personal (Send Money)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('merchant')}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      accountType === 'merchant'
                        ? 'bg-slate-800 text-white border border-slate-700'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Merchant (Payment)
                  </button>
                </div>
              </div>

              {/* Number display box with 1-click copy */}
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-medium">
                    {paymentMethod === 'bkash' ? 'bKash' : paymentMethod === 'nagad' ? 'Nagad' : 'Rocket'} {accountType === 'personal' ? 'Personal Number' : 'Merchant Number'}:
                  </span>
                  <span className="text-base sm:text-lg font-black font-mono text-white tracking-wider">
                    {currentAccountNumber}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyNumber(rawCopyNumber)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  title="Copy account number"
                >
                  {copiedNumber === rawCopyNumber ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Quick Instructions list */}
              <div className="text-[11px] text-slate-400 space-y-1.5 pt-1 leading-relaxed">
                {paymentMethod === 'rocket' ? (
                  <>
                    <p>
                      &bull; Open your <strong>Rocket App</strong> or dial <strong className="text-purple-300 font-mono">*322#</strong> &rarr; Select{' '}
                      <strong>{accountType === 'personal' ? 'Send Money' : 'Merchant Pay'}</strong>.
                    </p>
                    <p>
                      &bull; Enter number <strong className="text-white font-mono">{currentAccountNumber}</strong> and send exactly{' '}
                      <strong className="text-emerald-400 font-mono">{finalAmountToPay} BDT</strong>. Use reference:{' '}
                      <strong className="text-slate-300">{currentUser.email.split('@')[0]}</strong>.
                    </p>
                    <p>&bull; Copy the <strong>Transaction ID (TrxID)</strong> from confirmation SMS and attach receipt screenshot.</p>
                  </>
                ) : (
                  <>
                    <p>
                      &bull; Open your <strong>{paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} App</strong> &rarr; Select{' '}
                      <strong>{accountType === 'personal' ? 'Send Money' : 'Make Payment'}</strong>.
                    </p>
                    <p>
                      &bull; Send exactly <strong className="text-emerald-400 font-mono">{finalAmountToPay} BDT</strong>. Use reference:{' '}
                      <strong className="text-slate-300">{currentUser.email.split('@')[0]}</strong>.
                    </p>
                    <p>&bull; Copy the <strong>Transaction ID (TrxID)</strong> and take a receipt screenshot.</p>
                  </>
                )}
              </div>
            </div>

            {/* 4. Form Inputs: TrxID & Sender Phone */}
            <div className="space-y-3.5">
              <label className="text-xs font-bold text-slate-300 block">
                3. Enter Payment Verification Details:
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-300 flex items-center space-x-1">
                    <span>Transaction ID (TrxID)</span>
                    <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={trxId}
                    onChange={(e) => setTrxId(e.target.value.toUpperCase())}
                    placeholder="e.g. BL82K9X9 / 9A87B6C5"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs uppercase focus:border-emerald-500 focus:outline-none transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-300">
                    Sender Mobile Number (Optional)
                  </label>
                  <input
                    type="tel"
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    placeholder="e.g. 017XXXXXXXX"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {/* 5. Screenshot Upload Area */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-300 flex items-center space-x-1">
                    <span>Payment Receipt Screenshot</span>
                    <span className="text-slate-400 font-normal">(Optional but speeds up approval)</span>
                  </label>
                  {screenshotPreview && (
                    <button
                      type="button"
                      onClick={() => {
                        setScreenshotFile(null);
                        setScreenshotPreview(null);
                      }}
                      className="text-[10px] text-red-400 hover:text-red-300 flex items-center space-x-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>

                {screenshotPreview ? (
                  <div className="relative rounded-2xl bg-slate-950 border border-slate-800 p-3 flex items-center space-x-3.5">
                    <img
                      src={screenshotPreview}
                      alt="Payment screenshot receipt"
                      className="w-16 h-16 rounded-xl object-cover border border-slate-800 shrink-0"
                    />
                    <div className="min-w-0 flex-1 text-xs">
                      <span className="text-emerald-400 font-semibold block truncate">
                        {screenshotFile?.name || 'Payment_Receipt_Screenshot.png'}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {screenshotFile ? `${(screenshotFile.size / 1024).toFixed(1)} KB` : 'Attached proof'} &middot; Ready for admin review
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="p-4 rounded-2xl border-2 border-dashed border-slate-800 hover:border-slate-700 bg-slate-950/60 hover:bg-slate-950 flex flex-col items-center justify-center text-center cursor-pointer transition-colors space-y-1.5"
                  >
                    <Upload className="w-5 h-5 text-slate-400" />
                    <span className="text-xs text-slate-300 font-medium">
                      Click to upload receipt screenshot or drag &amp; drop
                    </span>
                    <span className="text-[10px] text-slate-400">
                      PNG, JPG, JPEG, WebP up to 10MB
                    </span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />
              </div>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Submit Action Button */}
            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs sm:text-sm shadow-xl shadow-emerald-950/60 hover:shadow-2xl hover:shadow-emerald-500/25 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting Payment Proof...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Submit Payment for Approval ({finalAmountToPay.toLocaleString()} BDT)</span>
                  </>
                )}
              </button>

              {/* Direct WhatsApp Support Button */}
              <div className="pt-1 border-t border-slate-800/80">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-850 border border-emerald-900/40 hover:border-emerald-600/60 text-emerald-400 hover:text-emerald-300 text-xs font-semibold flex items-center justify-center space-x-2 transition-all duration-300 ease-in-out hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Have questions or need fast approval? Contact WhatsApp: {WHATSAPP_DISPLAY}</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
