import React from 'react';
import { ShieldAlert, ArrowLeft, Radio, Lock } from 'lucide-react';
import { UserProfile } from '../services/apiClient';

interface AdminRouteProps {
  currentUser: UserProfile | null;
  children: React.ReactNode;
  onNavigateHome: () => void;
}

export const AdminRoute: React.FC<AdminRouteProps> = ({
  currentUser,
  children,
  onNavigateHome,
}) => {
  const isAdmin = currentUser?.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl bg-slate-900 border border-slate-800 p-8 text-center space-y-6 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-bold text-white tracking-tight">403 Forbidden - Admin Access Required</h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Access to the system scaling panel and cluster administration is strictly restricted to verified administrators. Your current role is <strong className="text-slate-200 uppercase font-semibold">{currentUser?.role || 'guest'}</strong>.
            </p>
          </div>

          <div className="pt-2">
            <button
              onClick={onNavigateHome}
              className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-red-950/60 cursor-pointer flex items-center justify-center space-x-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Live Studio Dashboard</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
