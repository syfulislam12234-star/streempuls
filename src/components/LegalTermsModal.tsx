import React, { useState, useMemo, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Scale,
  FileText,
  AlertTriangle,
  Lock,
  Coins,
  Ban,
  CheckCircle2,
  X,
  Search,
  ExternalLink,
  Copy,
  Check,
  Server,
  Eye,
  Radio,
  MessageCircle,
} from 'lucide-react';
import { apiClient, SiteContent } from '../services/apiClient';
import { useRealtimeSync, useConfigInvalidation } from '../context/RealtimeSyncContext';

export type LegalTab = 'terms' | 'privacy';

interface LegalTermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: LegalTab;
  initialSectionId?: string;
}

export const LegalTermsModal: React.FC<LegalTermsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'terms',
  initialSectionId,
}) => {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  // Real-Time live legal policies & fail-safe background invalidation on modal open
  const { siteContent: realtimeSiteContent } = useRealtimeSync();
  useConfigInvalidation(isOpen, 'content');
  const siteContent = realtimeSiteContent;

  // Sync tab if initialTab changes when opening
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Jump to specific section if requested
  React.useEffect(() => {
    if (isOpen && initialSectionId) {
      const el = document.getElementById(initialSectionId);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      }
    }
  }, [isOpen, initialSectionId, activeTab]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.origin + '#legal-terms');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800/80 bg-slate-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600/30 to-rose-600/10 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0 shadow-inner">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                  StreamPulse Legal &amp; Compliance Center
                </h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  v{siteContent?.version || '2.4'} &middot; {siteContent?.last_updated ? new Date(siteContent.last_updated).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Oct 2026'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Protecting continuous broadcasters, server infrastructure, and user data
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-auto">
            <button
              onClick={handleCopyLink}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] hover:shadow-md cursor-pointer"
              title="Copy link to terms"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy Link</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 cursor-pointer"
              title="Close Legal Terms"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Switcher & Search Bar */}
        <div className="px-5 sm:px-6 pt-3 pb-3 border-b border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-2xl border border-slate-800 shrink-0">
            <button
              onClick={() => setActiveTab('terms')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer ${
                activeTab === 'terms'
                  ? 'bg-red-600 text-white shadow-md shadow-red-950/60 hover:shadow-red-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Terms of Service &amp; AUP</span>
            </button>
            <button
              onClick={() => setActiveTab('privacy')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer ${
                activeTab === 'privacy'
                  ? 'bg-red-600 text-white shadow-md shadow-red-950/60 hover:shadow-red-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Lock className="w-4 h-4" />
              <span>Privacy Policy &amp; Security</span>
            </button>
          </div>

          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search policies (e.g., copyright, refund, keys)..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Policy Content Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-8 text-slate-300 leading-relaxed text-sm">
          {/* Quick Notice Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl bg-red-950/30 border border-red-800/40 space-y-1">
              <div className="flex items-center space-x-1.5 text-red-400 text-xs font-bold">
                <Ban className="w-4 h-4 shrink-0" />
                <span>Zero-Tolerance AUP</span>
              </div>
              <p className="text-[11px] text-slate-400">
                No pirated movies, scams, or adult content that harms YouTube API standing.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/40 space-y-1">
              <div className="flex items-center space-x-1.5 text-amber-400 text-xs font-bold">
                <Server className="w-4 h-4 shrink-0" />
                <span>Fair Usage &amp; Quotas</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Bandwidth and duration are strictly monitored. Abuse triggers automated suspension.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-blue-950/30 border border-blue-800/40 space-y-1">
              <div className="flex items-center space-x-1.5 text-blue-400 text-xs font-bold">
                <Coins className="w-4 h-4 shrink-0" />
                <span>Upfront &amp; No-Refund</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Subscriptions are prepaid. Once streaming hours are initiated, fees are non-refundable.
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-800/40 space-y-1">
              <div className="flex items-center space-x-1.5 text-emerald-400 text-xs font-bold">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Encrypted Credentials</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Stream keys and video assets are encrypted with AES-256 and never shared with 3rd parties.
              </p>
            </div>
          </div>

          {activeTab === 'terms' ? (
            /* ==================================================================== */
            /* TERMS OF SERVICE & ACCEPTABLE USE POLICY (AUP)                       */
            /* ==================================================================== */
            <div className="space-y-8">
              <section className="space-y-2">
                <span className="text-[11px] uppercase tracking-wider font-bold text-red-400">
                  Agreement Overview
                </span>
                <h3 className="text-xl font-bold text-white">StreamPulse Master Terms of Service</h3>
                <p>
                  Welcome to StreamPulse (&quot;StreamPulse&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
                  By registering an account, purchasing a subscription plan, configuring an RTMP stream key,
                  or dispatching streaming tasks through our cloud workers, you explicitly agree to comply with
                  and be bound by these Terms of Service. If you disagree with any part of these terms, you must
                  immediately discontinue use of the platform.
                </p>

                {siteContent?.terms_of_service && (
                  <div className="p-4 rounded-2xl bg-slate-950/90 border border-red-500/30 text-xs text-slate-300 space-y-2">
                    <div className="flex items-center space-x-1.5 text-red-400 font-bold">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Live Admin Terms &amp; Conditions Notice</span>
                    </div>
                    <div className="whitespace-pre-line leading-relaxed text-slate-200">
                      {siteContent.terms_of_service}
                    </div>
                  </div>
                )}
              </section>

              {/* SECTION 1: ACCEPTABLE USE POLICY */}
              <section id="aup" className="p-6 rounded-3xl bg-slate-950/80 border border-red-900/40 space-y-4">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-red-400 font-bold">
                      Section 1 &middot; Critical Rule
                    </span>
                    <h4 className="text-base font-bold text-white">
                      1. Acceptable Use Policy (AUP) &amp; Zero-Tolerance Content Rules
                    </h4>
                  </div>
                </div>

                {siteContent?.acceptable_use_policy && (
                  <div className="p-4 rounded-2xl bg-red-950/40 border border-red-700/50 text-xs text-slate-200 whitespace-pre-line leading-relaxed">
                    {siteContent.acceptable_use_policy}
                  </div>
                )}

                <div className="p-4 rounded-2xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-red-300 font-bold text-sm mb-1">
                      Strict Warning Against Malicious, Copyrighted, or Blacklisted Streaming
                    </strong>
                    StreamPulse provides high-bandwidth cloud encoding servers. Any use of our servers or
                    broadcasting infrastructure to stream prohibited content threatens our IP reputation,
                    domain security, and YouTube developer API authorization. We enforce an absolute
                    zero-tolerance policy.
                  </div>
                </div>

                <p className="text-xs sm:text-sm">
                  You agree that you will <strong className="text-white">NOT</strong> under any circumstance
                  broadcast, upload, loop, or transmit any of the following material:
                </p>

                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <li className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-start space-x-2">
                    <Ban className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white block">Copyrighted &amp; Pirated Media:</strong>
                      Unlicensed Hollywood movies, pirated TV shows, paid anime, pay-per-view sporting matches,
                      or music tracks without explicit broadcasting rights.
                    </div>
                  </li>

                  <li className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-start space-x-2">
                    <Ban className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white block">Adult, NSFW &amp; Explicit Content:</strong>
                      Pornography, sexually suggestive broadcasts, nudity, or graphic violence violating platform
                      community standards.
                    </div>
                  </li>

                  <li className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-start space-x-2">
                    <Ban className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white block">Scams, Fraud &amp; Fake Giveaways:</strong>
                      Cryptocurrency doubling scams, fake CEO Elon Musk/crypto livestreams, phishing pages,
                      get-rich-quick deceptions, or Ponzi schemes.
                    </div>
                  </li>

                  <li className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-start space-x-2">
                    <Ban className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-white block">Malicious Streams &amp; Network Attacks:</strong>
                      Streams embedding malicious payload links, denial-of-service bot triggers, network probing,
                      or any activity designed to blackhole server IPs.
                    </div>
                  </li>
                </ul>

                <div className="pt-2 text-xs text-slate-400">
                  <strong className="text-slate-300">AUP Enforcement Actions:</strong> If any stream violates this
                  AUP, StreamPulse reserves the right to immediately terminate the running stream, seize the
                  associated account, ban all registered IP addresses, and revoke access permanently with
                  <strong className="text-red-300"> no refund</strong>. We also cooperate with law enforcement and
                  intellectual property owners in responding to lawful DMCA takedown requests.
                </div>
              </section>

              {/* SECTION 2: FAIR USAGE & QUOTA LIMITS */}
              <section id="fair-usage" className="p-6 rounded-3xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-600/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-amber-400 font-bold">
                      Section 2 &middot; Infrastructure Protection
                    </span>
                    <h4 className="text-base font-bold text-white">
                      2. Fair Usage Policy &amp; Strict Resource Quotas
                    </h4>
                  </div>
                </div>

                <p>
                  To ensure 99.9% uptime and smooth, stutter-free playback for all creators across our global worker
                  cluster, StreamPulse assigns strict operational quotas based on the active plan tier:
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border border-slate-800 rounded-xl overflow-hidden">
                    <thead className="bg-slate-900 text-slate-200">
                      <tr>
                        <th className="p-3 border-b border-slate-800">Plan Tier</th>
                        <th className="p-3 border-b border-slate-800">Max Channels</th>
                        <th className="p-3 border-b border-slate-800">Video Storage Limit</th>
                        <th className="p-3 border-b border-slate-800">Streaming Duration</th>
                        <th className="p-3 border-b border-slate-800">Brand Watermark</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 text-slate-300">
                      <tr>
                        <td className="p-3 font-semibold text-slate-200">Free Trial (0 BDT)</td>
                        <td className="p-3">1 Channel</td>
                        <td className="p-3">1 Video (Up to 150MB)</td>
                        <td className="p-3">3 Days (10-hour total limit)</td>
                        <td className="p-3 text-amber-400 font-medium">Brand Watermark included</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-semibold text-blue-400">Basic Tier (1,200 BDT / ~$4)</td>
                        <td className="p-3">1 Channel live broadcast</td>
                        <td className="p-3">1 Video stored loop</td>
                        <td className="p-3">30 Days (24/7 continuous)</td>
                        <td className="p-3 text-emerald-400 font-medium">100% Brand-Free</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-semibold text-red-400">Pro Tier (4,000 BDT / ~$12)</td>
                        <td className="p-3">2 Channels concurrent streams</td>
                        <td className="p-3">2 Videos stored loops</td>
                        <td className="p-3">30 Days (24/7 continuous)</td>
                        <td className="p-3 text-emerald-400 font-medium">100% Brand-Free</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-semibold text-purple-400">Business Tier (12,000 BDT / ~$30)</td>
                        <td className="p-3">4 Channels concurrent live</td>
                        <td className="p-3">4 Videos stored loops</td>
                        <td className="p-3">30 Days (24/7 continuous)</td>
                        <td className="p-3 text-emerald-400 font-medium">100% Brand-Free</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2 text-xs">
                  <p>
                    <strong className="text-white">Encoding Standard &amp; Bitrate Caps:</strong> Users are expected
                    to broadcast at recommended standard RTMP bitrates (up to 1080p 60fps at 6,000 kbps max). Attempts
                    to force uncompressed 4K bitrates (&gt;20,000 kbps) that saturate network interfaces may result in
                    automatic downsampling or stream termination.
                  </p>
                  <p>
                    <strong className="text-white">Automated Watchdog Daemon:</strong> Our background worker daemon
                    continually audits CPU, RAM, and egress bandwidth. Accounts running unauthorized multi-processes or
                    attempting to bypass channel allocation constraints will have their stream processes
                    quarantined immediately.
                  </p>
                </div>
              </section>

              {/* SECTION 3: NO-REFUND & SUBSCRIPTION TERMS */}
              <section id="refund-policy" className="p-6 rounded-3xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                    <Coins className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-blue-400 font-bold">
                      Section 3 &middot; Commercial Policy
                    </span>
                    <h4 className="text-base font-bold text-white">
                      3. Subscription Billing &amp; Strict No-Refund Policy
                    </h4>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-blue-950/30 border border-blue-800/40 text-xs space-y-2">
                  <div className="flex items-center space-x-2 text-blue-300 font-bold text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Upfront Cloud Allocation &amp; Prepaid Model</span>
                  </div>
                  <p className="text-slate-300">
                    StreamPulse provisions dedicated CPU cycles, cloud video storage (R2/S3), and high-availability
                    bandwidth the instant an order is confirmed. Because infrastructure costs are committed upfront:
                  </p>
                </div>

                <ul className="space-y-2.5 text-xs">
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                    <span>
                      <strong className="text-white">No Refunds on Consumed Time:</strong> Once a subscription plan
                      is activated or streaming hours have commenced, <strong className="text-red-300">no refunds</strong>,
                      prorated credits, or chargebacks will be issued for unused hours, change of mind, or creator schedule changes.
                    </span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                    <span>
                      <strong className="text-white">Destination Platform Bans:</strong> If your YouTube channel,
                      Twitch account, or streaming account receives a copyright strike, community guideline violation, or
                      is terminated by the third-party platform for reasons related to your broadcast content, StreamPulse is
                      not responsible, and no refund will be provided.
                    </span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                    <span>
                      <strong className="text-white">Payment Methods &amp; Currency:</strong> Payments may be made via
                      bKash, Nagad, Rocket, Credit/Debit Cards, or Stripe. Subscription fees must be settled prior to
                      activation of paid tier features.
                    </span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                    <span>
                      <strong className="text-white">Chargeback Fraud:</strong> Any fraudulent chargeback or payment
                      dispute filed without contacting StreamPulse support will result in immediate permanent domain
                      and IP bans across our entire network infrastructure.
                    </span>
                  </li>
                </ul>
              </section>

              {/* SECTION 4: LIMITATION OF LIABILITY */}
              <section id="liability" className="p-6 rounded-3xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                    <Scale className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-purple-400 font-bold">
                      Section 4 &middot; Legal Disclaimer
                    </span>
                    <h4 className="text-base font-bold text-white">
                      4. Limitation of Liability &amp; Platform Availability
                    </h4>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <p>
                    <strong className="text-white">Service Provided &quot;As-Is&quot;:</strong> StreamPulse services,
                    cloud workers, and RTMP relays are provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot;
                    basis. While we engineer redundant streaming pipelines and monitor global clusters 24/7, we do
                    not guarantee that broadcasts will be completely uninterrupted, timely, or error-free.
                  </p>
                  <p>
                    <strong className="text-white">Third-Party Platform Dependencies:</strong> You acknowledge that
                    broadcasting to YouTube, Twitch, Kick, or custom CDNs depends entirely on those
                    third-party services. StreamPulse is NOT liable for:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-slate-400">
                    <li>Third-party platform downtime, ingest server drops, or scheduled maintenance.</li>
                    <li>Sudden changes in third-party API quotas, live streaming requirements, or subscriber thresholds.</li>
                    <li>Automatic stream termination by YouTube Content ID algorithms or copyright claims.</li>
                    <li>Stream key expirations or destination server resets executed by your broadcast provider.</li>
                  </ul>
                  <p>
                    <strong className="text-white">Cap on Damages:</strong> To the maximum extent permitted by applicable
                    law, StreamPulse&apos;s total aggregate liability arising out of or related to your use of the
                    service shall never exceed the total subscription fees paid by you in the single month preceding
                    the incident.
                  </p>
                </div>
              </section>
            </div>
          ) : (
            /* ==================================================================== */
            /* PRIVACY POLICY & DATA SECURITY                                       */
            /* ==================================================================== */
            <div className="space-y-8">
              <section className="space-y-2">
                <span className="text-[11px] uppercase tracking-wider font-bold text-emerald-400">
                  Data Governance
                </span>
                <h3 className="text-xl font-bold text-white">StreamPulse Privacy Policy &amp; Security</h3>
                <p>
                  At StreamPulse, we take your broadcast security, stream key confidentiality, and account privacy
                  seriously. This Privacy Policy details what information we collect, how it is secured, and your
                  rights regarding your data.
                </p>

                {siteContent?.privacy_policy && (
                  <div className="p-4 rounded-2xl bg-slate-950/90 border border-emerald-500/30 text-xs text-slate-300 space-y-2">
                    <div className="flex items-center space-x-1.5 text-emerald-400 font-bold">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Live Admin Privacy &amp; Data Security Directive</span>
                    </div>
                    <div className="whitespace-pre-line leading-relaxed text-slate-200">
                      {siteContent.privacy_policy}
                    </div>
                  </div>
                )}
              </section>

              {/* SECTION 5: DATA COLLECTED */}
              <section id="privacy-data" className="p-6 rounded-3xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <Eye className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold">
                      Section 5 &middot; Data Scope
                    </span>
                    <h4 className="text-base font-bold text-white">
                      5. Information We Collect &amp; How It Is Used
                    </h4>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                    <strong className="text-white block text-sm">Account &amp; Profile Data</strong>
                    <p className="text-slate-400">
                      Email address, user display name, subscription tier, transaction ID, and timestamp. Used
                      exclusively for authentication, subscription enforcement, and critical transactional notices.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                    <strong className="text-white block text-sm">Stream Destination Keys &amp; URLs</strong>
                    <p className="text-slate-400">
                      Your RTMP destination addresses (e.g., rtmp://a.rtmp.youtube.com/live2) and unique stream keys.
                      These credentials are used strictly by cloud workers to dispatch your video feed.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                    <strong className="text-white block text-sm">Uploaded Video &amp; Thumbnail Assets</strong>
                    <p className="text-slate-400">
                      MP4 video files and custom stream preview thumbnails you upload. Stored in high-performance
                      object storage to allow 24/7 cloud looping without local hardware power.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
                    <strong className="text-white block text-sm">Broadcast Diagnostics &amp; Telemetry</strong>
                    <p className="text-slate-400">
                      Outgoing frame rate (FPS), audio/video bitrate, packet drops, and FFmpeg worker logs. Used solely
                      for real-time stream telemetry and detecting ingest disconnections.
                    </p>
                  </div>
                </div>
              </section>

              {/* SECTION 6: SECURITY & ENCRYPTION */}
              <section id="privacy-security" className="p-6 rounded-3xl bg-slate-950/80 border border-emerald-900/40 space-y-4">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold">
                      Section 6 &middot; Cryptographic Guarantees
                    </span>
                    <h4 className="text-base font-bold text-white">
                      6. Industry-Standard Encryption &amp; Stream Key Protection
                    </h4>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-800/40 text-xs space-y-2">
                  <div className="flex items-center space-x-2 text-emerald-300 font-bold text-sm">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    <span>Your Stream Keys Are Private &amp; Never Shared</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    We understand that your stream keys allow broadcasting to your verified audience. StreamPulse
                    implements bank-grade security protocols:
                  </p>
                </div>

                <ul className="space-y-2.5 text-xs">
                  <li className="flex items-start space-x-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      <strong className="text-white">AES-256 Encryption at Rest:</strong> All stored stream keys,
                      passwords, and destination tokens are encrypted with military-grade AES-256 in secure databases.
                    </span>
                  </li>
                  <li className="flex items-start space-x-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      <strong className="text-white">TLS 1.3 in Transit:</strong> Communication between your browser,
                      our backend servers, and our worker fleet is strictly encrypted via modern TLS 1.3.
                    </span>
                  </li>
                  <li className="flex items-start space-x-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      <strong className="text-white">Zero Third-Party Sharing:</strong> We do <strong className="text-white">not</strong> sell,
                      rent, monetize, or disclose your stream keys, video assets, or audience data to advertising
                      networks or data brokers.
                    </span>
                  </li>
                  <li className="flex items-start space-x-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      <strong className="text-white">Ephemeral Process Isolation:</strong> Worker containers
                      terminate stream keys from memory immediately upon stopping a live broadcast.
                    </span>
                  </li>
                </ul>
              </section>

              {/* SECTION 7: USER RIGHTS & DATA RETENTION */}
              <section id="privacy-retention" className="p-6 rounded-3xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase text-blue-400 font-bold">
                      Section 7 &middot; User Control
                    </span>
                    <h4 className="text-base font-bold text-white">
                      7. Data Retention &amp; Right to Deletion
                    </h4>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <p>
                    <strong className="text-white">Asset Deletion:</strong> You have full control over your media.
                    When you delete a stream record or video file from your studio dashboard, the file is purged from
                    our active CDN and storage nodes.
                  </p>
                  <p>
                    <strong className="text-white">Account Termination:</strong> You may request full deletion of your
                    account and all associated metadata at any time by contacting our support team or sending a
                    written request to <span className="text-red-400 font-mono">support@streampulse.io</span>.
                  </p>
                </div>
              </section>
            </div>
          )}

          {/* Contact & Support Section */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="font-bold text-white block">Questions regarding our policies or subscription limits?</span>
              <div className="text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                <span>Legal Desk:</span>
                <a href="mailto:legal@streampulse.io" className="text-red-400 underline hover:text-red-300">
                  legal@streampulse.io
                </a>
                <span>&bull;</span>
                <a
                  href={`https://wa.me/${(siteContent?.support_whatsapp || '+8801712345678').replace(/[^0-9]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 font-semibold hover:underline inline-flex items-center space-x-1"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>WhatsApp: {siteContent?.support_whatsapp || '+8801712345678'}</span>
                </a>
              </div>
            </div>
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md shadow-red-950/60 hover:shadow-lg hover:shadow-red-500/25 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer shrink-0"
            >
              I Understand &amp; Agree
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
