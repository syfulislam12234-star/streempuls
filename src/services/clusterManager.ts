/**
 * StreamPulse - Plan-Based Dynamic Resource Allocation & Container Routing Engine
 * 
 * Provides:
 * 1. Tier Resource Profiles (Free, Basic, Pro, Business) with strict CPU / RAM limits.
 * 2. Automated Tier-Based Container Cluster Router.
 * 3. Autonomous Auto-Scaling Controller (Scales +1 container per 10 active users in tier).
 */

export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'business';

export interface TierResourceProfile {
  tier: SubscriptionTier;
  label: string;
  cpuLimit: string;
  cpuCores: number;
  memoryLimitMb: number;
  memoryLimitDisplay: string;
  maxBitrateKbps: number;
  maxResolution: string;
  maxDestinations: number;
  clusterId: string;
  clusterName: string;
  nodePool: string;
  priorityLevel: number;
  containerNice: number;
  ffmpegThreads: number;
  usersPerContainerRatio: number;
}

export const TIER_RESOURCE_PROFILES: Record<SubscriptionTier, TierResourceProfile> = {
  free: {
    tier: 'free',
    label: 'Free Sandbox Tier',
    cpuLimit: '1.5 vCPU',
    cpuCores: 1.5,
    memoryLimitMb: 2048,
    memoryLimitDisplay: '2048 MB (2 GB) RAM',
    maxBitrateKbps: 2500,
    maxResolution: '720p @ 30fps',
    maxDestinations: 1,
    clusterId: 'cluster-tier-free-prod',
    clusterName: 'Shared Sandbox Cluster (US-East / Hetzner)',
    nodePool: 'worker-pool-shared-free',
    priorityLevel: 1,
    containerNice: 10,
    ffmpegThreads: 1,
    usersPerContainerRatio: 10, // 1 container per 10 users
  },
  basic: {
    tier: 'basic',
    label: 'Basic Creator Tier',
    cpuLimit: '2.0 vCPU',
    cpuCores: 2.0,
    memoryLimitMb: 2560,
    memoryLimitDisplay: '2560 MB (2.5 GB) RAM',
    maxBitrateKbps: 4500,
    maxResolution: '1080p @ 30fps',
    maxDestinations: 1,
    clusterId: 'cluster-tier-basic-prod',
    clusterName: 'Standard Broadcast Cluster (EU-Central)',
    nodePool: 'worker-pool-standard-basic',
    priorityLevel: 2,
    containerNice: 5,
    ffmpegThreads: 2,
    usersPerContainerRatio: 10,
  },
  pro: {
    tier: 'pro',
    label: 'Pro Broadcaster Tier',
    cpuLimit: '2.0 vCPU',
    cpuCores: 2.0,
    memoryLimitMb: 2048,
    memoryLimitDisplay: '2048 MB (2 GB) RAM',
    maxBitrateKbps: 6500,
    maxResolution: '1080p @ 60fps Direct-Copy',
    maxDestinations: 2,
    clusterId: 'cluster-tier-pro-prod',
    clusterName: 'High-Performance Pro Cluster (Global Anycast)',
    nodePool: 'worker-pool-dedicated-pro',
    priorityLevel: 3,
    containerNice: 0,
    ffmpegThreads: 4,
    usersPerContainerRatio: 10,
  },
  business: {
    tier: 'business',
    label: 'Business Enterprise Tier',
    cpuLimit: '4.0 vCPU (Guaranteed)',
    cpuCores: 4.0,
    memoryLimitMb: 4096,
    memoryLimitDisplay: '4096 MB (4 GB) RAM',
    maxBitrateKbps: 12000,
    maxResolution: '4K @ 60fps (2160p Ultra HD)',
    maxDestinations: 4,
    clusterId: 'cluster-tier-business-prod',
    clusterName: 'Enterprise Ultra-Reliable Cluster (Multi-Region Failover)',
    nodePool: 'worker-pool-enterprise-sla',
    priorityLevel: 4,
    containerNice: -5,
    ffmpegThreads: 8,
    usersPerContainerRatio: 10,
  },
};

export interface ContainerInstance {
  id: string;
  clusterId: string;
  tier: SubscriptionTier;
  instanceName: string;
  status: 'active' | 'provisioning' | 'draining' | 'idle';
  cpuAllocated: string;
  ramAllocated: string;
  activeJobsCount: number;
  maxCapacity: number;
  assignedUsersCount: number;
  createdAt: string;
  lastHeartbeat: string;
  health: 'healthy' | 'degraded';
}

export interface AutoScaleEvent {
  id: string;
  timestamp: string;
  tier: SubscriptionTier;
  action: 'scale_up' | 'scale_down' | 'maintain';
  reason: string;
  userCount: number;
  instancesBefore: number;
  instancesAfter: number;
  allocatedContainers: string[];
}

export interface ClusterStatusReport {
  clusters: Record<
    SubscriptionTier,
    {
      profile: TierResourceProfile;
      activeUserCount: number;
      activeStreamCount: number;
      currentContainers: number;
      targetContainers: number;
      utilizationPct: number;
      instances: ContainerInstance[];
    }
  >;
  totalActiveContainers: number;
  totalUsersManaged: number;
  recentScaleEvents: AutoScaleEvent[];
  lastEvaluatedAt: string;
}

/**
 * In-memory Cluster State Store with initial baseline containers
 */
class ClusterRegistry {
  private instances: Map<string, ContainerInstance> = new Map();
  private scaleEvents: AutoScaleEvent[] = [];

  constructor() {
    this.bootstrapBaselineContainers();
  }

  private bootstrapBaselineContainers() {
    const tiers: SubscriptionTier[] = ['free', 'basic', 'pro', 'business'];
    tiers.forEach((tier) => {
      const profile = TIER_RESOURCE_PROFILES[tier];
      const id = `${profile.clusterId}-inst-01`;
      this.instances.set(id, {
        id,
        clusterId: profile.clusterId,
        tier,
        instanceName: `${tier.toUpperCase()}-NODE-01`,
        status: 'active',
        cpuAllocated: profile.cpuLimit,
        ramAllocated: profile.memoryLimitDisplay,
        activeJobsCount: 0,
        maxCapacity: 10,
        assignedUsersCount: 1,
        createdAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        health: 'healthy',
      });
    });
  }

  public getInstancesByTier(tier: SubscriptionTier): ContainerInstance[] {
    return Array.from(this.instances.values()).filter((inst) => inst.tier === tier && inst.status !== 'draining');
  }

  public getAllInstances(): ContainerInstance[] {
    return Array.from(this.instances.values());
  }

  public getScaleEvents(): AutoScaleEvent[] {
    return [...this.scaleEvents].slice(-20);
  }

  /**
   * Routes a streaming job to the least-loaded healthy container in the tier cluster
   */
  public routeStreamJob(
    tier: SubscriptionTier,
    streamId: string
  ): {
    container: ContainerInstance;
    profile: TierResourceProfile;
    routingMetadata: {
      clusterId: string;
      instanceId: string;
      nodePool: string;
      cgroupLimits: { cpu: string; memoryMb: number; nice: number };
    };
  } {
    const profile = TIER_RESOURCE_PROFILES[tier] || TIER_RESOURCE_PROFILES.free;
    const candidates = this.getInstancesByTier(profile.tier).filter((c) => c.status === 'active');

    // Pick least loaded instance or bootstrap one if none available
    let selected = candidates.sort((a, b) => a.activeJobsCount - b.activeJobsCount)[0];
    if (!selected) {
      const newId = `${profile.clusterId}-inst-${Math.floor(1000 + Math.random() * 9000)}`;
      selected = {
        id: newId,
        clusterId: profile.clusterId,
        tier: profile.tier,
        instanceName: `${profile.tier.toUpperCase()}-NODE-${this.instances.size + 1}`,
        status: 'active',
        cpuAllocated: profile.cpuLimit,
        ramAllocated: profile.memoryLimitDisplay,
        activeJobsCount: 0,
        maxCapacity: 10,
        assignedUsersCount: 1,
        createdAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        health: 'healthy',
      };
      this.instances.set(newId, selected);
    }

    selected.activeJobsCount += 1;
    selected.lastHeartbeat = new Date().toISOString();

    return {
      container: selected,
      profile,
      routingMetadata: {
        clusterId: profile.clusterId,
        instanceId: selected.id,
        nodePool: profile.nodePool,
        cgroupLimits: {
          cpu: profile.cpuLimit,
          memoryMb: profile.memoryLimitMb,
          nice: profile.containerNice,
        },
      },
    };
  }

  /**
   * Release a stream job from an instance
   */
  public releaseStreamJob(instanceId: string) {
    const inst = this.instances.get(instanceId);
    if (inst && inst.activeJobsCount > 0) {
      inst.activeJobsCount -= 1;
      inst.lastHeartbeat = new Date().toISOString();
    }
  }

  /**
   * Autonomous Scaling Logic:
   * Calculates required containers = ceil(userCount / 10), min 1 instance per tier.
   * Scales up or drains containers fully automatically.
   */
  public evaluateAutoScaling(
    tierUserCounts: Record<SubscriptionTier, number>,
    tierStreamCounts: Record<SubscriptionTier, number>
  ): AutoScaleEvent[] {
    const events: AutoScaleEvent[] = [];
    const tiers: SubscriptionTier[] = ['free', 'basic', 'pro', 'business'];

    tiers.forEach((tier) => {
      const profile = TIER_RESOURCE_PROFILES[tier];
      const userCount = tierUserCounts[tier] || 0;
      const streamCount = tierStreamCounts[tier] || 0;

      // Rule: +1 container instance per every 10 active users in the tier (min 1 container)
      const targetByUsers = Math.max(1, Math.ceil(userCount / profile.usersPerContainerRatio));
      const targetByStreams = Math.max(1, Math.ceil(streamCount / 8));
      const targetInstances = Math.max(targetByUsers, targetByStreams);

      const currentActive = this.getInstancesByTier(tier);
      const instancesBefore = currentActive.length;

      if (targetInstances > instancesBefore) {
        // SCALE UP
        const needed = targetInstances - instancesBefore;
        const newIds: string[] = [];
        for (let i = 0; i < needed; i++) {
          const index = instancesBefore + i + 1;
          const instId = `${profile.clusterId}-inst-0${index}`;
          const newInst: ContainerInstance = {
            id: instId,
            clusterId: profile.clusterId,
            tier,
            instanceName: `${tier.toUpperCase()}-CONTAINER-${String(index).padStart(2, '0')}`,
            status: 'active',
            cpuAllocated: profile.cpuLimit,
            ramAllocated: profile.memoryLimitDisplay,
            activeJobsCount: 0,
            maxCapacity: 10,
            assignedUsersCount: Math.min(10, Math.max(1, userCount - (instancesBefore + i) * 10)),
            createdAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
            health: 'healthy',
          };
          this.instances.set(instId, newInst);
          newIds.push(instId);
        }

        const ev: AutoScaleEvent = {
          id: `scale-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          timestamp: new Date().toISOString(),
          tier,
          action: 'scale_up',
          reason: `Autoscale trigger: ${userCount} active users in ${tier.toUpperCase()} tier requires ${targetInstances} container(s) (1 per 10 users).`,
          userCount,
          instancesBefore,
          instancesAfter: targetInstances,
          allocatedContainers: newIds,
        };
        this.scaleEvents.push(ev);
        events.push(ev);
      } else if (targetInstances < instancesBefore && instancesBefore > 1) {
        // SCALE DOWN gracefully
        const excess = instancesBefore - targetInstances;
        const removable = currentActive
          .filter((inst) => inst.activeJobsCount === 0 && !inst.id.endsWith('inst-01'))
          .slice(0, excess);

        const removedIds: string[] = [];
        removable.forEach((inst) => {
          inst.status = 'draining';
          this.instances.delete(inst.id);
          removedIds.push(inst.id);
        });

        if (removedIds.length > 0) {
          const ev: AutoScaleEvent = {
            id: `scale-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            timestamp: new Date().toISOString(),
            tier,
            action: 'scale_down',
            reason: `Autoscale scale-in: Low demand in ${tier.toUpperCase()} tier (${userCount} active users). Reclaiming ${removedIds.length} idle container(s).`,
            userCount,
            instancesBefore,
            instancesAfter: instancesBefore - removedIds.length,
            allocatedContainers: removedIds,
          };
          this.scaleEvents.push(ev);
          events.push(ev);
        }
      }
    });

    return events;
  }

  public getFullReport(
    tierUserCounts: Record<SubscriptionTier, number>,
    tierStreamCounts: Record<SubscriptionTier, number>
  ): ClusterStatusReport {
    const tiers: SubscriptionTier[] = ['free', 'basic', 'pro', 'business'];
    const clusters: any = {};
    let totalActiveContainers = 0;
    let totalUsersManaged = 0;

    tiers.forEach((tier) => {
      const profile = TIER_RESOURCE_PROFILES[tier];
      const instances = this.getInstancesByTier(tier);
      const activeUserCount = tierUserCounts[tier] || 0;
      const activeStreamCount = tierStreamCounts[tier] || 0;
      const targetContainers = Math.max(1, Math.ceil(activeUserCount / profile.usersPerContainerRatio));
      const totalCapacity = instances.length * 10;
      const totalJobs = instances.reduce((acc, curr) => acc + curr.activeJobsCount, 0);
      const utilizationPct = totalCapacity > 0 ? Math.round((totalJobs / totalCapacity) * 100) : 0;

      clusters[tier] = {
        profile,
        activeUserCount,
        activeStreamCount,
        currentContainers: instances.length,
        targetContainers,
        utilizationPct,
        instances,
      };

      totalActiveContainers += instances.length;
      totalUsersManaged += activeUserCount;
    });

    return {
      clusters,
      totalActiveContainers,
      totalUsersManaged,
      recentScaleEvents: this.getScaleEvents(),
      lastEvaluatedAt: new Date().toISOString(),
    };
  }
}

export const clusterRegistry = new ClusterRegistry();
