import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  Calendar,
  Coins,
  Users,
  Sparkles,
  Lock,
  ArrowRight,
  Activity,
  Award,
} from 'lucide-react';
import { DailyReferralMetric } from '../services/apiClient';

interface ReferralGrowthChartProps {
  data?: DailyReferralMetric[];
  isStarterFree: boolean;
  totalEarningsBdt: number;
  totalSignups: number;
  onOpenPlanModal?: () => void;
}

export const ReferralGrowthChart: React.FC<ReferralGrowthChartProps> = ({
  data = [],
  isStarterFree,
  totalEarningsBdt,
  totalSignups,
  onOpenPlanModal,
}) => {
  const [metricView, setMetricView] = useState<'both' | 'earnings' | 'signups'>('both');

  // Ensure 30 data points exist even if data is initially empty
  const chartData = useMemo(() => {
    if (data && data.length > 0) return data;

    // Fallback baseline for clean rendering
    const fallback: DailyReferralMetric[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      fallback.push({
        date: d.toISOString().split('T')[0],
        displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        signups: 0,
        earnedBdt: 0,
      });
    }
    return fallback;
  }, [data]);

  // Compute 30-day aggregations
  const stats30d = useMemo(() => {
    const total30dEarned = chartData.reduce((sum, item) => sum + (item.earnedBdt || 0), 0);
    const total30dSignups = chartData.reduce((sum, item) => sum + (item.signups || 0), 0);

    let peakDayEarned = 0;
    let peakDayDate = '';
    chartData.forEach((item) => {
      if (item.earnedBdt > peakDayEarned) {
        peakDayEarned = item.earnedBdt;
        peakDayDate = item.displayDate;
      }
    });

    const activeDays = chartData.filter((i) => i.signups > 0 || i.earnedBdt > 0).length;

    return {
      total30dEarned,
      total30dSignups,
      peakDayEarned,
      peakDayDate,
      activeDays,
    };
  }, [chartData]);

  // Custom Glassmorphic Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const currentItem = chartData.find((d) => d.displayDate === label);
      return (
        <div className="rounded-2xl bg-slate-900/95 border border-slate-700/80 p-3.5 shadow-2xl backdrop-blur-md text-xs space-y-2 min-w-[180px]">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 text-[11px] font-semibold text-slate-300">
            <span>{label}</span>
            {currentItem?.date && (
              <span className="font-mono text-slate-500 text-[10px]">
                {currentItem.date}
              </span>
            )}
          </div>

          <div className="space-y-1.5 font-mono">
            {(metricView === 'both' || metricView === 'earnings') && (
              <div className="flex items-center justify-between space-x-3 text-emerald-400">
                <span className="flex items-center space-x-1.5 text-slate-400 font-sans">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Earned BDT:</span>
                </span>
                <span className="font-bold">
                  ৳ {(currentItem?.earnedBdt || 0).toLocaleString()} BDT
                </span>
              </div>
            )}

            {(metricView === 'both' || metricView === 'signups') && (
              <div className="flex items-center justify-between space-x-3 text-amber-400">
                <span className="flex items-center space-x-1.5 text-slate-400 font-sans">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>New Sign-ups:</span>
                </span>
                <span className="font-bold">
                  {currentItem?.signups || 0} user{currentItem?.signups === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-5 sm:p-6 rounded-3xl bg-slate-950 border border-slate-800 shadow-xl space-y-5 relative overflow-hidden">
      {/* Decorative gradient glow background */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header & Controls - Natural document flow without floating or sticky z-index */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
              Referral Growth Trends
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60">
              Past 30 Days
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Daily new subscriber sign-ups and earned commissions from your promotional links.
          </p>
        </div>

        {/* View Toggle Tabs */}
        <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-2xl self-start sm:self-auto shrink-0">
          <button
            onClick={() => setMetricView('both')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              metricView === 'both'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Both Metrics
          </button>
          <button
            onClick={() => setMetricView('earnings')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              metricView === 'earnings'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Earned BDT
          </button>
          <button
            onClick={() => setMetricView('signups')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              metricView === 'signups'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign-ups
          </button>
        </div>
      </div>

      {/* 30-Day Snapshot Mini-Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-0.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center space-x-1">
            <Coins className="w-3 h-3 text-emerald-400" />
            <span>30D Earnings</span>
          </span>
          <div className="text-lg font-black text-white font-mono">
            ৳ {stats30d.total30dEarned.toLocaleString()}{' '}
            <span className="text-[10px] font-semibold text-emerald-400">BDT</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-0.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center space-x-1">
            <Users className="w-3 h-3 text-amber-400" />
            <span>30D Conversions</span>
          </span>
          <div className="text-lg font-black text-white font-mono">
            {stats30d.total30dSignups}{' '}
            <span className="text-[10px] font-semibold text-amber-400">creators</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-0.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center space-x-1">
            <Activity className="w-3 h-3 text-blue-400" />
            <span>Active Days</span>
          </span>
          <div className="text-lg font-black text-white font-mono">
            {stats30d.activeDays}{' '}
            <span className="text-[10px] font-semibold text-slate-400">/ 30 days</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-0.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center space-x-1">
            <Award className="w-3 h-3 text-purple-400" />
            <span>Peak 1-Day Earned</span>
          </span>
          <div className="text-lg font-black text-white font-mono">
            ৳ {stats30d.peakDayEarned.toLocaleString()}{' '}
            <span className="text-[10px] font-semibold text-purple-400">
              {stats30d.peakDayDate ? `(${stats30d.peakDayDate})` : 'BDT'}
            </span>
          </div>
        </div>
      </div>

      {/* Recharts Visualization Area */}
      <div className="relative w-full h-[280px] sm:h-[320px] pt-2">
        {isStarterFree && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm rounded-2xl p-6 text-center border border-amber-500/30">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center mb-3 shadow-lg shadow-amber-950/50">
              <Lock className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-white tracking-tight">
              Unlock Real-Time Referral Analytics
            </h4>
            <p className="text-xs text-amber-200/80 max-w-md mt-1 leading-relaxed">
              Upgrade to <strong>Creator Pro</strong> or <strong>Ultra</strong> to track daily subscriber conversions, audience traffic sources, and instant BDT earnings trends.
            </p>
            {onOpenPlanModal && (
              <button
                onClick={onOpenPlanModal}
                className="mt-4 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-xs font-bold text-white shadow-lg shadow-red-950/60 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center space-x-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Upgrade to Creator Pro</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
          >
            <defs>
              {/* Gradient for Earned BDT Area */}
              <linearGradient id="growthBdtGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              {/* Gradient for Signups Area */}
              <linearGradient id="growthSignupsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />

            <XAxis
              dataKey="displayDate"
              stroke="#64748b"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={{ stroke: '#334155' }}
              interval="preserveStartEnd"
              minTickGap={24}
            />

            {/* Left Y-Axis for Earned BDT */}
            <YAxis
              yAxisId="bdt"
              orientation="left"
              stroke="#10b981"
              tick={{ fill: '#10b981', fontSize: 11 }}
              tickLine={{ stroke: '#334155' }}
              tickFormatter={(v) => `৳${v}`}
              width={55}
            />

            {/* Right Y-Axis for Sign-ups */}
            <YAxis
              yAxisId="signups"
              orientation="right"
              stroke="#f59e0b"
              tick={{ fill: '#f59e0b', fontSize: 11 }}
              tickLine={{ stroke: '#334155' }}
              allowDecimals={false}
              width={35}
            />

            <Tooltip content={<CustomTooltip />} />

            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ paddingBottom: '12px', fontSize: '11px' }}
              formatter={(value) => (
                <span className="text-slate-300 font-semibold">{value}</span>
              )}
            />

            {/* Earned BDT Area Chart */}
            {(metricView === 'both' || metricView === 'earnings') && (
              <Area
                yAxisId="bdt"
                type="monotone"
                dataKey="earnedBdt"
                name="Earned BDT (৳)"
                stroke="#10b981"
                strokeWidth={2.5}
                fill="url(#growthBdtGrad)"
                activeDot={{ r: 5, fill: '#10b981', stroke: '#0f172a', strokeWidth: 2 }}
              />
            )}

            {/* Daily New Sign-ups Line Chart */}
            {(metricView === 'both' || metricView === 'signups') && (
              <Line
                yAxisId="signups"
                type="monotone"
                dataKey="signups"
                name="Daily Sign-ups"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#f59e0b', stroke: '#0f172a', strokeWidth: 1.5 }}
                activeDot={{ r: 6, fill: '#f59e0b', stroke: '#ffffff', strokeWidth: 2 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
