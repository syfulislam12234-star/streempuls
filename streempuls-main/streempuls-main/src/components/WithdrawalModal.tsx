import React, { useState } from 'react';
import {
  X,
  CreditCard,
  Building,
  Smartphone,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Coins,
  Clock,
  Info,
  Copy,
  Check,
  Printer,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import {
  apiClient,
  UserProfile,
  WithdrawalRequest,
} from '../services/apiClient';

interface WithdrawalModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  availableBalanceBdt: number;
  onWithdrawalSuccess: (withdrawal: WithdrawalRequest, newBalance: number) => void;
}

const BANGLADESH_BANKS = [
  'Dutch-Bangla Bank PLC (DBBL)',
  'BRAC Bank PLC',
  'The City Bank PLC',
  'Islami Bank Bangladesh PLC (IBBL)',
  'Eastern Bank PLC (EBL)',
  'Mutual Trust Bank (MTB)',
  'Sonali Bank PLC',
  'Standard Chartered Bangladesh',
  'Prime Bank PLC',
  'Dhaka Bank PLC',
  'United Commercial Bank (UCB)',
  'Pubali Bank PLC',
  'Other Commercial Bank',
];

export const WithdrawalModal: React.FC<WithdrawalModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  availableBalanceBdt,
  onWithdrawalSuccess,
}) => {
  const [amountInput, setAmountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'bkash' | 'nagad' | 'rocket' | 'bank'>('bkash');
  const [accountType, setAccountType] = useState<'personal' | 'agent' | 'merchant' | 'savings' | 'current'>('personal');
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [accountName, setAccountName] = useState<string>('');
  const [bankName, setBankName] = useState<string>('Dutch-Bangla Bank PLC (DBBL)');
  const [customBankName, setCustomBankName] = useState<string>('');
  const [branchName, setBranchName] = useState<string>('');
  const [routingNumber, setRoutingNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedWithdrawal, setSubmittedWithdrawal] = useState<WithdrawalRequest | null>(null);
  const [remainingBalance, setRemainingBalance] = useState<number>(availableBalanceBdt);
  const [copiedReceipt, setCopiedReceipt] = useState<boolean>(false);

  if (!isOpen) return null;

  const parsedAmount = Number(amountInput);
  const isBelowMin = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount < 500;
  const isAboveBalance = !isNaN(parsedAmount) && parsedAmount > availableBalanceBdt;

  const handleMaxAmount = () => {
    setAmountInput(String(Math.floor(availableBalanceBdt)));
    setErrorMessage(null);
  };

  const handleMethodChange = (method: 'bkash' | 'nagad' | 'rocket' | 'bank') => {
    setPaymentMethod(method);
    if (method === 'bank') {
      setAccountType('savings');
    } else {
      setAccountType('personal');
    }
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Minimum Threshold Validation (500 BDT)
    if (isNaN(parsedAmount) || parsedAmount < 500) {
      setErrorMessage('Minimum withdrawal amount is 500 BDT. Please request 500 BDT or more.');
      return;
    }

    // 2. Available Balance Validation
    if (parsedAmount > availableBalanceBdt) {
      setErrorMessage(
        `Requested amount (৳${parsedAmount.toLocaleString()} BDT) exceeds your available balance (৳${availableBalanceBdt.toLocaleString()} BDT).`
      );
      return;
    }

    // 3. Bangladeshi Mobile Wallet Number Validation
    const cleanNumber = accountNumber.trim().replace(/[\s-]/g, '');
    if (!cleanNumber) {
      setErrorMessage(
        paymentMethod === 'bank'
          ? 'Please enter your bank account number.'
          : `Please enter your receiving ${paymentMethod.toUpperCase()} mobile number.`
      );
      return;
    }

    if (['bkash', 'nagad', 'rocket'].includes(paymentMethod)) {
      let testNum = cleanNumber;
      if (testNum.startsWith('+88')) testNum = testNum.slice(3);
      if (testNum.startsWith('88')) testNum = testNum.slice(2);
      if (!/^01[3-9]\d{8}$/.test(testNum)) {
        setErrorMessage(
          `Invalid Bangladeshi mobile number for ${paymentMethod.toUpperCase()}. Must be 11 digits starting with 01 (e.g. 017XXXXXXXX).`
        );
        return;
      }
    }

    // 4. Bank Details Validation
    const resolvedBankName =
      paymentMethod === 'bank'
        ? bankName === 'Other Commercial Bank'
          ? customBankName.trim() || 'Other Bank'
          : bankName
        : undefined;

    if (paymentMethod === 'bank' && !resolvedBankName) {
      setErrorMessage('Please select or specify your Bank Name.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiClient.requestWithdrawal({
        userId: currentUser.id,
        amountBdt: parsedAmount,
        paymentMethod,
        accountType,
        accountNumber: cleanNumber,
        accountName: accountName.trim() || undefined,
        bankName: resolvedBankName,
        branchName: branchName.trim() || undefined,
        routingNumber: routingNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      setSubmittedWithdrawal(res.withdrawal);
      setRemainingBalance(res.remainingBalanceBdt);
      onWithdrawalSuccess(res.withdrawal, res.remainingBalanceBdt);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit withdrawal request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyReceipt = () => {
    if (!submittedWithdrawal) return;
    const resolvedBank = submittedWithdrawal.bank_name ? `\nBank: ${submittedWithdrawal.bank_name}` : '';
    const receiptText = `=== STREAMPULSE CREATOR PAYOUT RECEIPT ===
Receipt Ref: ${submittedWithdrawal.id.toUpperCase()}
Status: PENDING VERIFICATION
Requested Amount: ৳${submittedWithdrawal.amount_bdt.toLocaleString()} BDT
Payment Method: ${submittedWithdrawal.payment_method.toUpperCase()} (${submittedWithdrawal.account_type || 'Personal'})
Account: ${submittedWithdrawal.account_number}${resolvedBank}
Remaining Balance: ৳${remainingBalance.toLocaleString()} BDT
Date: ${new Date(submittedWithdrawal.created_at).toLocaleString()}
Processing Window: 24 - 48 Hours
=========================================`;

    navigator.clipboard.writeText(receiptText);
    setCopiedReceipt(true);
    setTimeout(() => setCopiedReceipt(false), 2500);
  };

  const handleClose = () => {
    setSubmittedWithdrawal(null);
    setErrorMessage(null);
    setAmountInput('');
    setAccountNumber('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-5 sm:p-7 shadow-2xl text-slate-100 my-auto max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500/20 to-emerald-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
                Creator Payout Portal
              </span>
              <h3 className="text-base sm:text-lg font-extrabold text-white">
                Withdraw Referral Earnings
              </h3>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            aria-label="Close withdrawal modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submittedWithdrawal ? (
          /* ==================================================================== */
          /* INSTANT CONFIRMATION RECEIPT VIEW                                    */
          /* ==================================================================== */
          <div className="space-y-5 py-4 animate-in zoom-in-95 duration-200">
            {/* Header Status */}
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-950/50">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <h4 className="text-lg sm:text-xl font-black text-white tracking-tight">
                  Withdrawal Request Submitted!
                </h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  Your funds are locked and queued for manual verification by finance.
                </p>
              </div>
            </div>

            {/* Official Digital Payout Receipt Card */}
            <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 sm:p-5 relative overflow-hidden space-y-3.5 shadow-xl text-xs">
              {/* Receipt Top Ribbon */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="font-mono text-[11px] font-bold text-slate-200">
                    RECEIPT #{submittedWithdrawal.id.toUpperCase()}
                  </span>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/90 text-amber-300 border border-amber-500/40 uppercase flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>Pending</span>
                </span>
              </div>

              {/* Amount Highlight */}
              <div className="text-center py-2 bg-slate-900/50 rounded-xl border border-slate-800/60">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                  Requested Payout Amount
                </span>
                <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono mt-0.5">
                  ৳ {submittedWithdrawal.amount_bdt.toLocaleString()}{' '}
                  <span className="text-xs font-bold text-slate-300">BDT</span>
                </div>
              </div>

              {/* Receipt Details Breakdown */}
              <div className="space-y-2 text-slate-300">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Payment Channel:</span>
                  <span className="text-white font-bold uppercase flex items-center space-x-1.5">
                    {submittedWithdrawal.payment_method === 'bkash' && (
                      <span className="w-2 h-2 rounded-full bg-pink-500" />
                    )}
                    {submittedWithdrawal.payment_method === 'nagad' && (
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                    )}
                    {submittedWithdrawal.payment_method === 'rocket' && (
                      <span className="w-2 h-2 rounded-full bg-purple-500" />
                    )}
                    {submittedWithdrawal.payment_method === 'bank' && (
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                    )}
                    <span>
                      {submittedWithdrawal.payment_method}{' '}
                      <span className="text-slate-400 capitalize text-[11px]">
                        ({submittedWithdrawal.account_type || 'Personal'})
                      </span>
                    </span>
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Receiving Account:</span>
                  <span className="text-white font-mono font-semibold">
                    {submittedWithdrawal.account_number}
                  </span>
                </div>

                {submittedWithdrawal.bank_name && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Bank Name:</span>
                    <span className="text-slate-200 font-medium">
                      {submittedWithdrawal.bank_name}
                    </span>
                  </div>
                )}

                {submittedWithdrawal.account_name && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Account Holder:</span>
                    <span className="text-slate-200 font-medium">
                      {submittedWithdrawal.account_name}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t border-slate-800/80">
                  <span className="text-slate-400">Remaining Balance:</span>
                  <span className="text-amber-400 font-mono font-bold">
                    ৳ {remainingBalance.toLocaleString()} BDT
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Estimated Settlement:</span>
                  <span className="text-slate-200 flex items-center space-x-1 font-semibold">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>24 to 48 Hours</span>
                  </span>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1">
                  <span>Timestamp:</span>
                  <span>{new Date(submittedWithdrawal.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Receipt Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyReceipt}
                className="flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
              >
                {copiedReceipt ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied Reference!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Receipt Details</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                title="Print Receipt"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Print</span>
              </button>
            </div>

            <button
              onClick={handleClose}
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer shadow-lg shadow-emerald-950/40"
            >
              Done &amp; Return to Dashboard
            </button>
          </div>
        ) : (
          /* ==================================================================== */
          /* WITHDRAWAL FORM VIEW                                                 */
          /* ==================================================================== */
          <form onSubmit={handleSubmit} className="space-y-4 pt-4 text-xs">
            {/* Available Balance Overview Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-950/30 via-slate-950 to-emerald-950/20 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                  Available Withdrawable Balance
                </span>
                <div className="text-xl sm:text-2xl font-black text-white font-mono mt-0.5">
                  ৳ {availableBalanceBdt.toLocaleString()}{' '}
                  <span className="text-xs font-bold text-amber-400">BDT</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-semibold text-slate-400 block">
                  Minimum Payout
                </span>
                <span className="text-xs font-mono font-bold text-emerald-400">
                  500 BDT
                </span>
              </div>
            </div>

            {/* 1. Amount Input with Quick Max */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200">
                  1. Payout Amount (BDT): <span className="text-red-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={handleMaxAmount}
                  disabled={availableBalanceBdt < 500}
                  className="text-[11px] font-bold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer disabled:opacity-40"
                >
                  Use Max Available
                </button>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-mono text-sm">
                  ৳
                </div>
                <input
                  type="number"
                  min={500}
                  max={availableBalanceBdt}
                  step={10}
                  required
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Min 500 BDT (e.g. 1000)"
                  className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:border-amber-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Threshold feedback */}
              {isBelowMin && (
                <p className="text-[11px] text-amber-400 flex items-center space-x-1 mt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Minimum payout limit is 500 BDT.</span>
                </p>
              )}
              {isAboveBalance && (
                <p className="text-[11px] text-red-400 flex items-center space-x-1 mt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Amount exceeds available balance of ৳{availableBalanceBdt.toLocaleString()} BDT.</span>
                </p>
              )}
            </div>

            {/* 2. Channel Selector & Dropdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 block">
                  2. Select Receiving Channel: <span className="text-red-400">*</span>
                </label>
                {/* Dropdown alternative */}
                <div className="relative">
                  <select
                    value={paymentMethod}
                    onChange={(e) => handleMethodChange(e.target.value as any)}
                    className="bg-slate-950 text-slate-300 border border-slate-800 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="bkash">bKash</option>
                    <option value="nagad">Nagad</option>
                    <option value="rocket">Rocket</option>
                    <option value="bank">Bank Transfer</option>
                  </select>
                </div>
              </div>

              {/* Visual Card Selector with Branded Accents */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => handleMethodChange('bkash')}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                    paymentMethod === 'bkash'
                      ? 'bg-pink-950/50 border-pink-500 text-white ring-2 ring-pink-500/40 shadow-lg shadow-pink-950/40 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  <Smartphone className="w-4 h-4 mx-auto mb-1 text-pink-400" />
                  <span className="text-xs block font-bold">bKash</span>
                  <span className="text-[9px] text-pink-300/80 block mt-0.5">Instant Wallet</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleMethodChange('nagad')}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                    paymentMethod === 'nagad'
                      ? 'bg-orange-950/50 border-orange-500 text-white ring-2 ring-orange-500/40 shadow-lg shadow-orange-950/40 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  <Smartphone className="w-4 h-4 mx-auto mb-1 text-orange-400" />
                  <span className="text-xs block font-bold">Nagad</span>
                  <span className="text-[9px] text-orange-300/80 block mt-0.5">Instant Wallet</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleMethodChange('rocket')}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                    paymentMethod === 'rocket'
                      ? 'bg-purple-950/50 border-purple-500 text-white ring-2 ring-purple-500/40 shadow-lg shadow-purple-950/40 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  <Smartphone className="w-4 h-4 mx-auto mb-1 text-purple-400" />
                  <span className="text-xs block font-bold">Rocket</span>
                  <span className="text-[9px] text-purple-300/80 block mt-0.5">DBBL Wallet</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleMethodChange('bank')}
                  className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                    paymentMethod === 'bank'
                      ? 'bg-blue-950/50 border-blue-500 text-white ring-2 ring-blue-500/40 shadow-lg shadow-blue-950/40 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  <Building className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                  <span className="text-xs block font-bold">Bank</span>
                  <span className="text-[9px] text-blue-300/80 block mt-0.5">Direct EFT/NPSB</span>
                </button>
              </div>
            </div>

            {/* 3. Account Type Selector */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300 block">
                Account Type:
              </label>
              {paymentMethod === 'bank' ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountType('savings')}
                    className={`py-1.5 px-3 rounded-xl border text-center text-xs font-semibold cursor-pointer ${
                      accountType === 'savings'
                        ? 'bg-blue-950/40 border-blue-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Savings Account
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('current')}
                    className={`py-1.5 px-3 rounded-xl border text-center text-xs font-semibold cursor-pointer ${
                      accountType === 'current'
                        ? 'bg-blue-950/40 border-blue-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Current / Business
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountType('personal')}
                    className={`py-1.5 px-2 rounded-xl border text-center text-xs font-semibold cursor-pointer ${
                      accountType === 'personal'
                        ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Personal
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('merchant')}
                    className={`py-1.5 px-2 rounded-xl border text-center text-xs font-semibold cursor-pointer ${
                      accountType === 'merchant'
                        ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Merchant
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('agent')}
                    className={`py-1.5 px-2 rounded-xl border text-center text-xs font-semibold cursor-pointer ${
                      accountType === 'agent'
                        ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    Agent
                  </button>
                </div>
              )}
            </div>

            {/* 4. Dynamic Account Details Inputs */}
            <div className="space-y-3 pt-1">
              {paymentMethod !== 'bank' ? (
                /* Mobile Wallet Input */
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-200 flex items-center justify-between">
                    <span>
                      {paymentMethod.toUpperCase()} Mobile Number:{' '}
                      <span className="text-red-400">*</span>
                    </span>
                    <span className="text-[10px] text-slate-400">11 Digits</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-xs">
                      🇧🇩 +88
                    </div>
                    <input
                      type="text"
                      required
                      value={accountNumber}
                      onChange={(e) => {
                        setAccountNumber(e.target.value);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="017XXXXXXXX / 018XXXXXXXX"
                      maxLength={14}
                      className="w-full pl-16 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-amber-500 focus:outline-none transition-colors"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Ensure this wallet is active and capable of receiving Cash-In / Send Money transfers.
                  </p>
                </div>
              ) : (
                /* Bank Transfer Inputs */
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-200">
                      Bank Name: <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-amber-500 focus:outline-none transition-colors cursor-pointer"
                    >
                      {BANGLADESH_BANKS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>

                  {bankName === 'Other Commercial Bank' && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-200">
                        Specify Bank Name: <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={customBankName}
                        onChange={(e) => setCustomBankName(e.target.value)}
                        placeholder="e.g. Standard Bank PLC"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-amber-500 focus:outline-none transition-colors"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-200">
                        Account Number: <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        placeholder="e.g. 151.110.XXXXXX"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-amber-500 focus:outline-none transition-colors"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-200">
                        Account Holder Name: <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        placeholder="e.g. Md. Syful Islam"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-amber-500 focus:outline-none transition-colors"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-200">
                        Branch Name &amp; District:
                      </label>
                      <input
                        type="text"
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value)}
                        placeholder="e.g. Dhanmondi, Dhaka"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-amber-500 focus:outline-none transition-colors"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-slate-200">
                        Routing Number (Optional):
                      </label>
                      <input
                        type="text"
                        value={routingNumber}
                        onChange={(e) => setRoutingNumber(e.target.value)}
                        placeholder="e.g. 09027XXXX"
                        maxLength={9}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:border-amber-500 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Optional Reference Note */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">
                  Optional Note / Reference:
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Creator Affiliate Payout October"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-amber-500 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-xs text-red-200 flex items-start space-x-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || availableBalanceBdt < 500}
                className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-600 via-emerald-600 to-emerald-500 hover:from-amber-500 hover:to-emerald-400 text-white font-extrabold text-xs sm:text-sm shadow-xl shadow-emerald-950/50 hover:shadow-2xl transition-all duration-300 ease-in-out hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing Payout Request...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>
                      Submit Withdrawal Request{' '}
                      {parsedAmount >= 500 ? `(৳ ${parsedAmount.toLocaleString()} BDT)` : ''}
                    </span>
                  </>
                )}
              </button>
              <p className="text-[10px] text-slate-400 text-center mt-2">
                Processed via secure local disbursement within 24 to 48 business hours. Minimum threshold is 500 BDT.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
