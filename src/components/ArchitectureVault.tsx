import React, { useState } from 'react';
import { Database, Server, Cpu, Layers, ShieldCheck, Copy, Check, Download, ExternalLink } from 'lucide-react';
import { SqlViewer } from './SqlViewer';
import { BackendGatewayViewer } from './BackendGatewayViewer';
import { ArchitectureBlueprint } from './ArchitectureBlueprint';
import { ErdVisualizer } from './ErdVisualizer';

export const ArchitectureVault: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'task1-sql' | 'task2-api' | 'task3-worker' | 'task4-docker' | 'erd'>('task1-sql');

  const subTabs = [
    { id: 'task1-sql', label: '1. Supabase SQL DDL (Task 1)', icon: Database },
    { id: 'task2-api', label: '2. API Gateway & Queue (Task 2)', icon: Server },
    { id: 'task3-worker', label: '3. FFmpeg Worker (Task 3)', icon: Cpu },
    { id: 'task4-docker', label: '4. Docker & Scaling (Task 4)', icon: Layers },
    { id: 'erd', label: '5. Schema ERD & Security (RLS)', icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6">
      {/* Clean Segmented Sub-Navigation (Zero clutter) */}
      <div className="p-2 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex items-center justify-between overflow-x-auto scrollbar-none">
        <div className="flex items-center space-x-1.5">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Render Selected View Cleanly */}
      <div className="transition-all">
        {activeSubTab === 'task1-sql' && <SqlViewer />}
        {activeSubTab === 'task2-api' && <BackendGatewayViewer />}
        {activeSubTab === 'task3-worker' && <BackendGatewayViewer />}
        {activeSubTab === 'task4-docker' && <ArchitectureBlueprint />}
        {activeSubTab === 'erd' && <ErdVisualizer />}
      </div>
    </div>
  );
};
