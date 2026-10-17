import React, { useState, useEffect } from 'react';
import {
  Users,
  ShieldCheck,
  ShieldAlert,
  Search,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  RefreshCw,
  AlertCircle,
  Sliders,
  ChevronDown,
  UserCheck,
  UserX,
  Award,
  CreditCard,
  Smartphone,
  MessageCircle,
  Save,
} from 'lucide-react';
import { apiClient, UserProfile, SubscriptionTier } from '../services/apiClient';

interface AdminUserManagementProps {
  currentUser: UserProfile | null;
}

export const AdminUserManagement: React.FC<AdminUserManagementProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // User Statistics & Dynamic Payment Settings State
  const [userStats, setUserStats] = useState({
    totalRegisteredUsers: 10482,
    activeUsers: 3415,
    realUsersCount: 1,
    activeSubscriptionsCount: 1,
    pendingPaymentsCount: 0,
  });

  const [paymentSettingsForm, setPaymentSettingsForm] = useState({
    bkash_personal: '01712-345678',
    bkash_merchant: '01987-654321',
    nagad_personal: '01812-345678',
    nagad_merchant: '01612-345678',
    rocket_personal: '01712-345678',
    rocket_merchant: '01987-654321',
    whatsapp_number: '+8801712345678',
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);

  const fetchUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await apiClient.getAdminUsers();
      setUsers(list);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch registered users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    apiClient.getAdminUserStats().then((s) => {
      if (s) setUserStats(s);
    }).catch(() => {});

    apiClient.getPaymentSettings().then((s) => {
      if (s) setPaymentSettingsForm(s);
    }).catch(() => {});
  }, []);

  const handleSavePaymentSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsSuccess(null);
    setError(null);
    try {
      const updated = await apiClient.updatePaymentSettings(paymentSettingsForm);
      if (updated) setPaymentSettingsForm(updated);
      setSettingsSuccess('Payment gateway & WhatsApp support numbers updated successfully in real-time!');
      setTimeout(() => setSettingsSuccess(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to update payment settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleToggleStatus = async (user: UserProfile) => {
    const newStatus = user.subscription_status === 'active' ? 'unpaid' : 'active';
    setActionLoadingId(user.id);
    setError(null);
    try {
      const updated = await apiClient.updateAdminUserStatus(user.id, newStatus);
      setUsers(users.map((u) => (u.id === updated.id ? updated : u)));
      setSuccessMessage(`User ${user.email} status updated to ${newStatus}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleBlock = async (user: UserProfile) => {
    const isBlocked = user.subscription_status === 'blocked';
    const newStatus = isBlocked ? 'active' : 'blocked';
    setActionLoadingId(user.id);
    setError(null);
    try {
      const updated = await apiClient.updateAdminUserStatus(user.id, newStatus);
      setUsers(users.map((u) => (u.id === updated.id ? updated : u)));
      setSuccessMessage(`User ${user.email} ${isBlocked ? 'unblocked & restored' : 'blocked successfully'}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to block/unblock user');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleChangePlan = async (userId: string, newTier: SubscriptionTier) => {
    setActionLoadingId(userId);
    setError(null);
    try {
      const updated = await apiClient.updateAdminUserPlan(userId, newTier);
      setUsers(users.map((u) => (u.id === updated.id ? updated : u)));
      setSuccessMessage(`User plan changed to ${newTier.toUpperCase()}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to change plan');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleRole = async (user: UserProfile) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    setActionLoadingId(user.id);
    setError(null);
    try {
      const updated = await apiClient.updateAdminUserRole(user.id, newRole);
      setUsers(users.map((u) => (u.id === updated.id ? updated : u)));
      setSuccessMessage(`User role changed to ${newRole.toUpperCase()}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update user role');
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-extrabold text-white tracking-tight">
                Admin User Management Panel
              </h2>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-red-950 text-red-300 border border-red-800/60 font-mono font-bold uppercase">
                Secure API &bull; RBAC Protected
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage all registered user accounts, subscription tiers, access status, and administrator permissions.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by email or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          <button
            onClick={fetchUsers}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer"
            title="Refresh Users"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-red-400' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Feedback Messages */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* 1. User Statistics Metrics Cards (With ~10k+ Baseline Seeding) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Total Registered Users</span>
            <Users className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white">
            {userStats.totalRegisteredUsers.toLocaleString()}
          </div>
          <p className="text-[11px] text-emerald-400 font-medium">
            &bull; Established baseline + live signups
          </p>
        </div>

        <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Active Users (Recent)</span>
            <UserCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-400">
            {userStats.activeUsers.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-400">
            &bull; Authenticated &amp; streaming sessions
          </p>
        </div>

        <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Active Subscriptions</span>
            <ShieldCheck className="w-5 h-5 text-purple-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-purple-400">
            {userStats.activeSubscriptionsCount}
          </div>
          <p className="text-[11px] text-slate-400">
            &bull; Pro, Business &amp; Basic active tiers
          </p>
        </div>

        <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Pending Payments</span>
            <CreditCard className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-amber-400">
            {userStats.pendingPaymentsCount}
          </div>
          <p className="text-[11px] text-amber-300">
            &bull; Awaiting admin approval queue
          </p>
        </div>
      </div>

      {/* 2. Dynamic Payment Gateway & WhatsApp Numbers Settings Panel */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white tracking-tight">
                Dynamic Payment Gateway &amp; WhatsApp Support Numbers
              </h3>
              <p className="text-xs text-slate-400">
                Update bKash, Nagad, Rocket numbers and WhatsApp support in real-time. Changes apply instantly to checkout modals.
              </p>
            </div>
          </div>
        </div>

        {settingsSuccess && (
          <div className="p-3.5 rounded-2xl bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{settingsSuccess}</span>
          </div>
        )}

        <form onSubmit={handleSavePaymentSettings} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* bKash */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="font-bold text-pink-400 uppercase tracking-wide block">bKash Numbers</span>
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block">Personal Number (Send Money)</label>
                <input
                  type="text"
                  value={paymentSettingsForm.bkash_personal}
                  onChange={(e) => setPaymentSettingsForm({ ...paymentSettingsForm, bkash_personal: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white font-mono text-xs focus:border-pink-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block">Merchant Number (Payment)</label>
                <input
                  type="text"
                  value={paymentSettingsForm.bkash_merchant}
                  onChange={(e) => setPaymentSettingsForm({ ...paymentSettingsForm, bkash_merchant: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white font-mono text-xs focus:border-pink-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Nagad */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="font-bold text-amber-400 uppercase tracking-wide block">Nagad Numbers</span>
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block">Personal Number (Send Money)</label>
                <input
                  type="text"
                  value={paymentSettingsForm.nagad_personal}
                  onChange={(e) => setPaymentSettingsForm({ ...paymentSettingsForm, nagad_personal: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block">Merchant Number (Payment)</label>
                <input
                  type="text"
                  value={paymentSettingsForm.nagad_merchant}
                  onChange={(e) => setPaymentSettingsForm({ ...paymentSettingsForm, nagad_merchant: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Rocket & WhatsApp */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="font-bold text-purple-400 uppercase tracking-wide block">Rocket &amp; WhatsApp</span>
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block">Rocket Personal / Merchant</label>
                <input
                  type="text"
                  value={paymentSettingsForm.rocket_personal}
                  onChange={(e) => setPaymentSettingsForm({ ...paymentSettingsForm, rocket_personal: e.target.value, rocket_merchant: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white font-mono text-xs focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400 block">Official WhatsApp Support Number</label>
                <input
                  type="text"
                  value={paymentSettingsForm.whatsapp_number}
                  onChange={(e) => setPaymentSettingsForm({ ...paymentSettingsForm, whatsapp_number: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSavingSettings}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {isSavingSettings ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Save Gateway &amp; Support Numbers</span>
            </button>
          </div>
        </form>
      </div>

      {/* Users Table */}
      <div className="rounded-3xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="py-4 px-5">User &amp; Email</th>
                <th className="py-4 px-4">Role</th>
                <th className="py-4 px-4">Subscription Status</th>
                <th className="py-4 px-4">Current Plan</th>
                <th className="py-4 px-5 text-right">Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-xs">
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-red-500 mb-2" />
                    Loading registered users from Supabase...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    No users found matching your search criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const isBusy = actionLoadingId === user.id;
                  const isActive = user.subscription_status === 'active';
                  const isBlocked = user.subscription_status === 'blocked';
                  const isAdmin = user.role === 'admin';

                  return (
                    <tr key={user.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 px-5">
                        <div className="space-y-0.5">
                          <div className="font-bold text-white flex items-center space-x-2">
                            <span>{user.full_name || user.email.split('@')[0]}</span>
                            {currentUser?.id === user.id && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 font-mono">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-slate-400 font-mono text-[11px]">{user.email}</div>
                        </div>
                      </td>

                      <td className="py-4 px-4">
                        <button
                          onClick={() => handleToggleRole(user)}
                          disabled={isBusy}
                          className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border cursor-pointer transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 ${
                            isAdmin
                              ? 'bg-purple-950/80 text-purple-300 border-purple-800 hover:bg-purple-900 hover:shadow-sm'
                              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:shadow-sm'
                          }`}
                          title="Click to toggle user role between admin and user"
                        >
                          {isAdmin ? <ShieldCheck className="w-3 h-3 text-purple-400" /> : <Users className="w-3 h-3" />}
                          <span>{user.role}</span>
                        </button>
                      </td>

                      <td className="py-4 px-4">
                        <span
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${
                            isActive
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                              : isBlocked
                              ? 'bg-red-950/80 text-red-300 border-red-800'
                              : 'bg-amber-950/80 text-amber-300 border-amber-800'
                          }`}
                        >
                          {isActive ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3" />}
                          <span>{user.subscription_status}</span>
                        </span>
                      </td>

                      <td className="py-4 px-4">
                        <select
                          value={user.subscription_tier}
                          onChange={(e) => handleChangePlan(user.id, e.target.value as SubscriptionTier)}
                          disabled={isBusy}
                          className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-semibold focus:outline-none focus:border-red-500 cursor-pointer"
                        >
                          <option value="free">Free (3 Days)</option>
                          <option value="basic">Basic (1,200৳)</option>
                          <option value="pro">Pro (4,000৳)</option>
                          <option value="business">Business (12,000৳)</option>
                        </select>
                      </td>

                      <td className="py-4 px-5 text-right space-x-2">
                        {/* Activate / Deactivate Plan Button */}
                        <button
                          onClick={() => handleToggleStatus(user)}
                          disabled={isBusy}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer inline-flex items-center space-x-1 ${
                            isActive
                              ? 'bg-amber-950/40 border-amber-800/60 text-amber-300 hover:bg-amber-900/50 hover:shadow-sm'
                              : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50 hover:shadow-sm'
                          }`}
                          title="Toggle subscription active status"
                        >
                          {isActive ? (
                            <>
                              <Lock className="w-3 h-3 text-amber-400" />
                              <span>Deactivate</span>
                            </>
                          ) : (
                            <>
                              <Unlock className="w-3 h-3 text-emerald-400" />
                              <span>Activate</span>
                            </>
                          )}
                        </button>

                        {/* Block / Unblock User Button */}
                        <button
                          onClick={() => handleToggleBlock(user)}
                          disabled={isBusy}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer inline-flex items-center space-x-1 ${
                            isBlocked
                              ? 'bg-blue-950/40 border-blue-800/60 text-blue-300 hover:bg-blue-900/50 hover:shadow-sm'
                              : 'bg-red-950/40 border-red-800/60 text-red-300 hover:bg-red-900/50 hover:shadow-sm'
                          }`}
                          title="Restrict or restore account access"
                        >
                          {isBlocked ? (
                            <>
                              <UserCheck className="w-3 h-3 text-blue-400" />
                              <span>Unblock</span>
                            </>
                          ) : (
                            <>
                              <UserX className="w-3 h-3 text-red-400" />
                              <span>Block</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
