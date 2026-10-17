import React, { useState } from 'react';
import { Copy, Check, Download, Database, Key, ShieldCheck, Zap, Sparkles, Filter, ExternalLink } from 'lucide-react';
import { SUPABASE_SQL_DDL } from '../data/rawSql';
import { TABLES_DATA, RLS_POLICIES_DATA } from '../data/schemaData';

export const SqlViewer: React.FC = () => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleCopy = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2500);
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([SUPABASE_SQL_DDL], { type: 'text/plain;charset=utf-8' });
    element.href = URL.createObjectURL(file);
    element.download = 'supabase_streampulse_247_schema.sql';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Extract sections
  const getSectionContent = () => {
    switch (activeSection) {
      case 'profiles':
        return extractBlock('-- 3. TABLE: profiles', '-- 4. TABLE: streams');
      case 'streams':
        return extractBlock('-- 4. TABLE: streams', '-- 5. TABLE: system_settings');
      case 'system_settings':
        return extractBlock('-- 5. TABLE: system_settings', '-- 6. TABLE: stream_logs');
      case 'stream_logs':
        return extractBlock('-- 6. TABLE: stream_logs', '-- 7. PERFORMANCE INDEXES');
      case 'triggers':
        return extractBlock('-- 8. DATABASE FUNCTIONS & AUTOMATION TRIGGERS', '-- 9. ROW LEVEL SECURITY (RLS) POLICIES');
      case 'rls':
        return extractBlock('-- 9. ROW LEVEL SECURITY (RLS) POLICIES', '-- END OF SCHEMA');
      default:
        return SUPABASE_SQL_DDL;
    }
  };

  function extractBlock(startMarker: string, endMarker: string): string {
    const startIndex = SUPABASE_SQL_DDL.indexOf(startMarker);
    const endIndex = SUPABASE_SQL_DDL.indexOf(endMarker);
    if (startIndex === -1) return SUPABASE_SQL_DDL;
    if (endIndex === -1) return SUPABASE_SQL_DDL.slice(startIndex);
    return SUPABASE_SQL_DDL.slice(startIndex, endIndex).trim();
  }

  const currentCode = getSectionContent();

  const filteredCode = searchQuery
    ? currentCode
        .split('\n')
        .filter((line) => line.toLowerCase().includes(searchQuery.toLowerCase()))
        .join('\n')
    : currentCode;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-red-950/40 border border-slate-800 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2 text-xs font-mono uppercase tracking-wider text-red-400 mb-1">
              <Database className="w-4 h-4 text-red-500" />
              <span>TASK 1 Architecture Spec &middot; Supabase PostgreSQL 15+</span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Production DDL Schema & Row Level Security (RLS)
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-3xl">
              Engineered for <span className="text-emerald-400 font-semibold">Zero-Lag isolated Node.js FFmpeg workers</span>, 
              direct-copy streaming (<code className="text-amber-300 bg-slate-950/60 px-1 py-0.5 rounded text-xs">-c copy</code>), 
              Supabase Storage media vaults (<code className="text-emerald-300 bg-slate-950/60 px-1 py-0.5 rounded text-xs">stream-assets</code>), and <span className="text-blue-400 font-semibold">1-Click Admin Dynamic Scaling</span> without container redeployments.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => handleCopy(SUPABASE_SQL_DDL, 'all')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-medium text-xs shadow-lg shadow-red-950/60 transition-all cursor-pointer"
            >
              {copiedSection === 'all' ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
              <span>{copiedSection === 'all' ? 'Copied Full DDL!' : 'Copy Complete SQL DDL'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center space-x-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download .sql</span>
            </button>
          </div>
        </div>

        {/* Quick Highlights Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-800/80">
          <div className="flex items-center space-x-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Auth & Profiles</p>
              <p className="text-[11px] text-slate-400">auth.users sync trigger</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">24/7 Streams</p>
              <p className="text-[11px] text-slate-400">PID & heartbeat telemetry</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">System Settings</p>
              <p className="text-[11px] text-slate-400">1-Click dynamic scaling</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Granular RLS</p>
              <p className="text-[11px] text-slate-400">Multi-tenant isolation</p>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive SQL Explorer Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800">
        {/* Section Filters */}
        <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All DDL Statements' },
            { id: 'profiles', label: '1. profiles' },
            { id: 'streams', label: '2. streams' },
            { id: 'system_settings', label: '3. system_settings' },
            { id: 'stream_logs', label: '4. stream_logs' },
            { id: 'triggers', label: 'Triggers & Quotas' },
            { id: 'rls', label: 'RLS Policies' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                activeSection === tab.id
                  ? 'bg-red-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Section Copy */}
        <div className="flex items-center space-x-2">
          <div className="relative flex-1 sm:w-56">
            <Filter className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search SQL syntax..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-red-500"
            />
          </div>

          <button
            onClick={() => handleCopy(currentCode, activeSection)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 font-mono transition-colors whitespace-nowrap cursor-pointer"
          >
            {copiedSection === activeSection ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSection === activeSection ? 'Copied!' : 'Copy Section'}</span>
          </button>
        </div>
      </div>

      {/* Code Editor Frame */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-2xl">
        {/* Code Header Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-xs font-mono text-slate-400">
          <div className="flex items-center space-x-2">
            <div className="flex space-x-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
            </div>
            <span className="text-slate-300 font-semibold pl-2">
              supabase_schema.sql &mdash; Section: <span className="text-red-400">{activeSection}</span>
            </span>
          </div>
          <div className="flex items-center space-x-3 text-[11px]">
            <span>PostgreSQL 15</span>
            <span className="text-slate-600">|</span>
            <span>Supabase RLS Enabled</span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-400">{filteredCode.split('\n').length} lines</span>
          </div>
        </div>

        {/* Code Body */}
        <div className="p-4 overflow-x-auto max-h-[640px] scrollbar-thin scrollbar-thumb-slate-800 font-mono text-xs leading-relaxed text-slate-300 selection:bg-red-900/60">
          <pre className="table w-full">
            <code>
              {filteredCode.split('\n').map((line, index) => {
                const isComment = line.trim().startsWith('--');
                const isKeyword =
                  /\b(CREATE|TABLE|IF|NOT|EXISTS|PRIMARY|KEY|REFERENCES|CASCADE|ON|DELETE|DEFAULT|NOT|NULL|CHECK|TEXT|UUID|INTEGER|BOOLEAN|TIMESTAMPTZ|VARCHAR|BIGINT|NUMERIC|JSONB|ALTER|ENABLE|ROW|LEVEL|SECURITY|POLICY|USING|WITH|CHECK|SELECT|INSERT|UPDATE|FUNCTION|TRIGGER|RETURNS|BEGIN|END|DECLARE|EXECUTE|FOR|EACH|ROW|INDEX)\b/g.test(
                    line
                  );

                return (
                  <div key={index} className="table-row hover:bg-slate-900/50">
                    <span className="table-cell select-none pr-4 text-right text-slate-600 w-10 text-[11px]">
                      {index + 1}
                    </span>
                    <span
                      className={`table-cell whitespace-pre ${
                        isComment
                          ? 'text-slate-500 italic'
                          : line.includes('CREATE TABLE') || line.includes('CREATE POLICY') || line.includes('CREATE TRIGGER')
                          ? 'text-amber-300 font-bold'
                          : isKeyword
                          ? 'text-slate-200'
                          : 'text-slate-400'
                      }`}
                    >
                      {line}
                    </span>
                  </div>
                );
              })}
            </code>
          </pre>
        </div>
      </div>

      {/* Deployment & Execution Guide */}
      <div className="p-5 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
            <span>How to execute this in your Supabase Project</span>
          </h4>
          <p className="text-xs text-slate-400">
            Open your Supabase Dashboard &rarr; Click <span className="text-slate-200 font-mono bg-slate-800 px-1 py-0.5 rounded">SQL Editor</span> &rarr; Paste this script &rarr; Click <span className="text-emerald-400 font-semibold">Run</span>. 
            All tables, triggers, ENUMs, and RLS policies will be automatically provisioned in ~1.2 seconds.
          </p>
        </div>
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors whitespace-nowrap"
        >
          <span>Open Supabase Dashboard</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};
