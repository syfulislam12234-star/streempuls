import React, { useState, useEffect } from 'react';
import {
  Tag,
  Plus,
  Trash2,
  CheckCircle2,
  X,
  Loader2,
  Percent,
  DollarSign,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { apiClient, Coupon, SubscriptionTier } from '../services/apiClient';

interface AdminCouponsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminCouponsModal: React.FC<AdminCouponsModalProps> = ({ isOpen, onClose }) => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [newCode, setNewCode] = useState<string>('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed_bdt'>('percent');
  const [discountValue, setDiscountValue] = useState<number>(20);
  const [applicableTiers, setApplicableTiers] = useState<SubscriptionTier[]>(['basic', 'pro', 'business']);
  const [maxUses, setMaxUses] = useState<number>(500);

  const fetchCoupons = async () => {
    setIsLoading(true);
    try {
      const list = await apiClient.getAdminCoupons();
      setCoupons(list);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch coupons');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCoupons();
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim()) return;
    setIsCreating(true);
    setError(null);

    try {
      await apiClient.createAdminCoupon({
        code: newCode.trim().toUpperCase(),
        discountType,
        discountValue: Number(discountValue),
        applicableTiers,
        maxUses: Number(maxUses),
      });

      setNewCode('');
      setDiscountValue(20);
      fetchCoupons();
    } catch (err: any) {
      setError(err.message || 'Failed to create promo code');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteCoupon = async (id: string) => {
    try {
      await apiClient.deleteAdminCoupon(id);
      fetchCoupons();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate promo code');
    }
  };

  const toggleTier = (tier: SubscriptionTier) => {
    if (applicableTiers.includes(tier)) {
      if (applicableTiers.length > 1) {
        setApplicableTiers(applicableTiers.filter((t) => t !== tier));
      }
    } else {
      setApplicableTiers([...applicableTiers, tier]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-6 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-extrabold text-white tracking-tight">
                  Promo Code &amp; Discount Manager
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-mono font-bold uppercase">
                  Admin Schema &bull; /api/admin/coupons
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Generate, validate, and apply percentage or fixed-amount discounts during checkout
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

        {error && (
          <div className="p-3 rounded-2xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-center space-x-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {/* Create Promo Code Card */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-white flex items-center space-x-1.5">
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>Create New Promo Code</span>
            </h4>

            <form onSubmit={handleCreateCoupon} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Coupon Code</label>
                  <input
                    type="text"
                    required
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    placeholder="e.g. FLASH50"
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-mono uppercase focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Discount Type</label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="percent">Percentage (% Off)</option>
                    <option value="fixed_bdt">Fixed Amount (BDT Off)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {discountType === 'percent' ? 'Discount Percentage (%)' : 'Discount Amount (BDT)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={discountType === 'percent' ? 100 : 12000}
                    required
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Applicable Tiers selector */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  Applicable Subscription Tiers:
                </label>
                <div className="flex flex-wrap gap-2 text-xs">
                  {(['basic', 'pro', 'business'] as SubscriptionTier[]).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => toggleTier(tier)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize border cursor-pointer transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 ${
                        applicableTiers.includes(tier)
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-950/50'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isCreating || !newCode.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md shadow-emerald-950/60 hover:shadow-lg hover:shadow-emerald-500/25 flex items-center space-x-1.5"
                >
                  {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Save &amp; Activate Coupon</span>
                </button>
              </div>
            </form>
          </div>

          {/* Active Promo Codes List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
              <span>Active Database Promo Codes ({coupons.filter((c) => c.is_active).length})</span>
              <button
                onClick={fetchCoupons}
                className="text-slate-400 hover:text-white flex items-center space-x-1 transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {coupons.map((coupon) => (
              <div
                key={coupon.id}
                className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs transition-all ${
                  coupon.is_active
                    ? 'bg-slate-950 border-slate-800'
                    : 'bg-slate-950/40 border-slate-900 opacity-60'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-extrabold text-sm text-white tracking-wide">
                      {coupon.code}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                      {coupon.discount_type === 'percent' ? `${coupon.discount_value}% OFF` : `${coupon.discount_value} BDT OFF`}
                    </span>
                    {!coupon.is_active && (
                      <span className="text-[10px] text-slate-500">Deactivated</span>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-400 flex items-center space-x-3">
                    <span>
                      Tiers: <strong className="text-slate-300 uppercase">{coupon.applicable_tiers.join(', ')}</strong>
                    </span>
                    <span>&bull;</span>
                    <span>
                      Uses: <strong className="text-slate-300">{coupon.times_used} / {coupon.max_uses}</strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {coupon.is_active && (
                    <button
                      onClick={() => handleDeleteCoupon(coupon.id)}
                      className="p-1.5 rounded-lg bg-slate-900 hover:bg-red-950/60 hover:text-red-300 text-slate-400 text-xs transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
                      title="Deactivate Promo Code"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
