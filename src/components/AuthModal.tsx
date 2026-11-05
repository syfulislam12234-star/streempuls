import React, { useState } from 'react';
import {
  X,
  User,
  Mail,
  Lock,
  ArrowRight,
  ShieldCheck,
  UserPlus,
  LogIn,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Database,
  Zap,
} from 'lucide-react';
import { apiClient, UserProfile } from '../services/apiClient';
import { LegalTermsModal } from './LegalTermsModal';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: UserProfile) => void;
  onOpenLegal?: (tab?: 'terms' | 'privacy', sectionId?: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  onOpenLegal,
}) => {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('password123');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localShowLegal, setLocalShowLegal] = useState(false);
  const [localInitialTab, setLocalInitialTab] = useState<'terms' | 'privacy'>('terms');
  const [localInitialSection, setLocalInitialSection] = useState<string | undefined>(undefined);

  const handleOpenLegalClick = (tab?: 'terms' | 'privacy', sectionId?: string) => {
    if (onOpenLegal) {
      onOpenLegal(tab, sectionId);
    } else {
      setLocalInitialTab(tab || 'terms');
      setLocalInitialSection(sectionId);
      setLocalShowLegal(true);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMsg('Please enter an email address.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      let user: UserProfile;
      if (mode === 'register') {
        user = await apiClient.registerUser({
          email: email.trim(),
          password,
          full_name: fullName.trim() || undefined,
        });
      } else {
        user = await apiClient.loginUser({
          email: email.trim(),
          password,
        });
      }

      onAuthSuccess(user);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication request failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 sm:p-7 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-600/10 border border-red-500/20 text-red-500 flex items-center justify-center">
              {mode === 'register' ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                {mode === 'register' ? 'Register New Account' : 'Sign In to StreamPulse'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {mode === 'register'
                  ? 'New accounts default to unpaid/pending subscription status'
                  : 'Access your 24/7 live streaming dashboard'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/80 border border-red-800 text-red-200 text-xs flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 font-bold ml-2">✕</button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 block">Full Name</label>
              <input
                type="text"
                required
                maxLength={120}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Alex Johnson"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300 block">Email Address *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-red-500 focus:outline-none"
            />
          </div>

          {/* Secure Token Authentication Indicator */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center space-x-2.5 text-xs text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="leading-snug">
              <span className="font-semibold text-white block">Secure Account Access</span>
              <span className="text-[11px] text-slate-400">Authenticated session management with token verification</span>
            </div>
          </div>

          {/* Legal Compliance Terms Agreement Note */}
          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-start space-x-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                By {mode === 'register' ? 'registering' : 'signing in'}, you agree to StreamPulse&apos;s{' '}
                <button
                  type="button"
                  onClick={() => handleOpenLegalClick('terms')}
                  className="text-red-400 hover:text-red-300 underline font-semibold cursor-pointer"
                >
                  Terms of Service
                </button>
                ,{' '}
                <button
                  type="button"
                  onClick={() => handleOpenLegalClick('privacy')}
                  className="text-red-400 hover:text-red-300 underline font-semibold cursor-pointer"
                >
                  Privacy Policy
                </button>
                , and{' '}
                <button
                  type="button"
                  onClick={() => handleOpenLegalClick('terms', 'aup')}
                  className="text-amber-400 hover:text-amber-300 underline font-semibold cursor-pointer"
                >
                  Acceptable Use Policy (AUP)
                </button>
                .
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] shadow-md hover:shadow-lg hover:shadow-red-500/20 cursor-pointer flex items-center justify-center space-x-2"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === 'register' ? (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Create Account</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>

        {/* Toggle between Register & Login */}
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'register' ? 'login' : 'register');
              setErrorMsg(null);
            }}
            className="text-xs text-slate-400 hover:text-white underline transition-all duration-300 ease-in-out cursor-pointer"
          >
            {mode === 'register'
              ? 'Already have an account? Sign In'
              : "Don't have an account? Create one"}
          </button>
        </div>
      </div>

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
