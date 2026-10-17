import React, { useState } from 'react';
import { Database, ShieldCheck, Key, ArrowRight, Layers, Lock, CheckCircle2, ChevronRight } from 'lucide-react';
import { TABLES_DATA, RLS_POLICIES_DATA } from '../data/schemaData';

export const ErdVisualizer: React.FC = () => {
  const [selectedTable, setSelectedTable] = useState<string>('profiles');

  const currentTable = TABLES_DATA.find((t) => t.name === selectedTable) || TABLES_DATA[0];

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800 shadow-xl">
        <div className="flex items-center space-x-2 text-xs font-mono uppercase tracking-wider text-indigo-400 mb-1">
          <Database className="w-4 h-4 text-indigo-400" />
          <span>Entity Relationship Diagram & Row-Level Security Matrix</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">
          Relational Architecture & Multi-Tenant Security Model
        </h2>
        <p className="text-sm text-slate-300 mt-1 max-w-3xl">
          Visual representation of foreign key cascading relations, data ownership boundaries, 
          and enterprise Supabase RLS security policies preventing cross-tenant leakage.
        </p>
      </div>

      {/* Visual ERD Flowchart */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-x-auto">
        <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-6 flex items-center space-x-2">
          <Layers className="w-4 h-4 text-emerald-400" />
          <span>Database Topology & Foreign Key Relationships</span>
        </h3>

        <div className="flex flex-col lg:flex-row items-center justify-between gap-6 min-w-[760px] py-4 px-2">
          {/* Node 1: auth.users */}
          <div className="w-56 p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-lg relative group">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <span className="text-xs font-mono font-bold text-slate-400">auth.users</span>
              <Lock className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <p className="text-[11px] text-slate-400 mb-2">Supabase Auth engine managed identity provider.</p>
            <div className="space-y-1 font-mono text-[11px]">
              <div className="flex items-center text-amber-400">
                <Key className="w-3 h-3 mr-1 text-amber-400" />
                <span>id (UUID)</span>
              </div>
              <div className="text-slate-400 pl-4">email (text)</div>
              <div className="text-slate-400 pl-4">encrypted_password</div>
            </div>
          </div>

          <div className="flex items-center space-x-1 text-slate-600 font-mono text-xs">
            <span>1:1</span>
            <ArrowRight className="w-4 h-4 text-blue-500" />
          </div>

          {/* Node 2: profiles */}
          <div
            onClick={() => setSelectedTable('profiles')}
            className={`w-64 p-4 rounded-xl border shadow-lg cursor-pointer transition-all ${
              selectedTable === 'profiles'
                ? 'bg-slate-950 border-red-500 ring-2 ring-red-500/20'
                : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <span className="text-xs font-mono font-bold text-white">public.profiles</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 font-mono">1:1 Core</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-2">User quotas, plan tiers, and stream allowances.</p>
            <div className="space-y-1 font-mono text-[11px]">
              <div className="flex items-center text-amber-400">
                <Key className="w-3 h-3 mr-1" />
                <span>id &rarr; auth.users</span>
              </div>
              <div className="text-slate-300 pl-4">plan_tier (enum)</div>
              <div className="text-emerald-400 pl-4 font-semibold">max_concurrent_streams</div>
              <div className="text-slate-400 pl-4">role (user_role_enum)</div>
            </div>
          </div>

          <div className="flex items-center space-x-1 text-slate-600 font-mono text-xs">
            <span>1:N</span>
            <ArrowRight className="w-4 h-4 text-red-500" />
          </div>

          {/* Node 3: streams */}
          <div
            onClick={() => setSelectedTable('streams')}
            className={`w-64 p-4 rounded-xl border shadow-lg cursor-pointer transition-all ${
              selectedTable === 'streams'
                ? 'bg-slate-950 border-red-500 ring-2 ring-red-500/20'
                : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <span className="text-xs font-mono font-bold text-white">public.streams</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 font-mono">1:N Engine</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-2">24/7 RTMP pipelines, R2 video URLs, telemetry.</p>
            <div className="space-y-1 font-mono text-[11px]">
              <div className="flex items-center text-amber-400">
                <Key className="w-3 h-3 mr-1" />
                <span>id (UUID)</span>
              </div>
              <div className="flex items-center text-blue-400 pl-4">
                <Key className="w-2.5 h-2.5 mr-1" />
                <span>user_id &rarr; profiles</span>
              </div>
              <div className="text-slate-300 pl-4">stream_key (masked)</div>
              <div className="text-emerald-400 pl-4 font-semibold">direct_copy_mode: true</div>
              <div className="text-amber-400 pl-4">ffmpeg_pid & heartbeat</div>
            </div>
          </div>

          <div className="flex items-center space-x-1 text-slate-600 font-mono text-xs">
            <span>1:N</span>
            <ArrowRight className="w-4 h-4 text-amber-500" />
          </div>

          {/* Node 4: stream_logs */}
          <div
            onClick={() => setSelectedTable('stream_logs')}
            className={`w-60 p-4 rounded-xl border shadow-lg cursor-pointer transition-all ${
              selectedTable === 'stream_logs'
                ? 'bg-slate-950 border-red-500 ring-2 ring-red-500/20'
                : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <span className="text-xs font-mono font-bold text-white">public.stream_logs</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 font-mono">Telemetry</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-2">Partitioned stdout/stderr diagnostic tail.</p>
            <div className="space-y-1 font-mono text-[11px]">
              <div className="text-amber-400">id (BIGINT IDENTITY)</div>
              <div className="text-blue-400 pl-4">stream_id &rarr; streams</div>
              <div className="text-slate-300 pl-4">level (info/error/ffmpeg)</div>
            </div>
          </div>
        </div>

        {/* Singleton Cluster Node */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-mono text-slate-400">Global Cluster Singleton:</span>
            <button
              onClick={() => setSelectedTable('system_settings')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border ${
                selectedTable === 'system_settings'
                  ? 'bg-purple-950/80 text-purple-300 border-purple-500'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              public.system_settings &rarr; (1-Click Dynamic Scaling Supervisor)
            </button>
          </div>
          <span className="text-xs text-slate-500 font-mono">Read by all authenticated users &middot; Write restricted to Admin</span>
        </div>
      </div>

      {/* Selected Table Data Dictionary */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-lg font-bold text-white font-mono">{currentTable.name}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 uppercase font-mono">
                {currentTable.category}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{currentTable.description}</p>
          </div>

          <div className="flex items-center space-x-2">
            {TABLES_DATA.map((t) => (
              <button
                key={t.name}
                onClick={() => setSelectedTable(t.name)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                  selectedTable === t.name
                    ? 'bg-red-600 text-white font-semibold'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {/* Columns Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3">Column Name</th>
                <th className="py-2.5 px-3">Data Type</th>
                <th className="py-2.5 px-3">Constraints</th>
                <th className="py-2.5 px-3">Default</th>
                <th className="py-2.5 px-3 font-sans">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {currentTable.columns.map((col) => (
                <tr key={col.name} className="hover:bg-slate-950/40">
                  <td className="py-2.5 px-3 font-semibold text-white flex items-center space-x-1.5">
                    {col.isPrimaryKey && <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                    <span>{col.name}</span>
                  </td>
                  <td className="py-2.5 px-3 text-purple-400">{col.type}</td>
                  <td className="py-2.5 px-3">
                    {col.isPrimaryKey ? (
                      <span className="text-amber-400 font-bold">PRIMARY KEY</span>
                    ) : col.foreignKey ? (
                      <span className="text-blue-400">FK: {col.foreignKey}</span>
                    ) : col.nullable ? (
                      <span className="text-slate-500">NULLABLE</span>
                    ) : (
                      <span className="text-slate-400">NOT NULL</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-amber-300">{col.defaultValue || '-'}</td>
                  <td className="py-2.5 px-3 font-sans text-slate-400 text-xs">{col.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row Level Security (RLS) Policy Audit Matrix */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-base font-semibold text-white">Row Level Security (RLS) Policy Audit Matrix</h3>
        </div>
        <p className="text-xs text-slate-400">
          Supabase multi-tenant isolation policies configured for production compliance.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono">
                <th className="py-2.5 px-3">Target Table</th>
                <th className="py-2.5 px-3">Policy Identifier</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Rule Definition</th>
                <th className="py-2.5 px-3">Security Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {RLS_POLICIES_DATA.map((policy) => (
                <tr key={policy.name} className="hover:bg-slate-950/40">
                  <td className="py-3 px-3 font-semibold text-white">{policy.table}</td>
                  <td className="py-3 px-3 text-blue-400">{policy.name}</td>
                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        policy.action === 'SELECT'
                          ? 'bg-blue-950 text-blue-300'
                          : policy.action === 'INSERT'
                          ? 'bg-emerald-950 text-emerald-300'
                          : policy.action === 'UPDATE'
                          ? 'bg-amber-950 text-amber-300'
                          : 'bg-red-950 text-red-300'
                      }`}
                    >
                      {policy.action}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-emerald-400 text-[11px] max-w-xs truncate">
                    <code>{policy.definition}</code>
                  </td>
                  <td className="py-3 px-3 font-sans text-slate-400 text-xs">{policy.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
