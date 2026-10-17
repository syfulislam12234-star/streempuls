import React, { useState } from 'react';
import { StreamingDashboard } from './StreamingDashboard';

/**
 * StreamWorkerSimulator - Legacy alias routed to the redesigned clean user dashboard.
 * Completely hides all technical developer logs, PID, CPU, FFmpeg, and terminal details.
 */
export const StreamWorkerSimulator: React.FC = () => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <StreamingDashboard
      isCreateModalOpen={isCreateModalOpen}
      setIsCreateModalOpen={setIsCreateModalOpen}
    />
  );
};
