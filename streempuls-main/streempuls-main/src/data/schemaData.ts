export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey?: boolean;
  foreignKey?: string;
  description: string;
}

export interface TableDefinition {
  name: string;
  description: string;
  category: 'core' | 'streaming' | 'system' | 'logging';
  columns: TableColumn[];
}

export interface RlsPolicy {
  table: string;
  name: string;
  action: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  roles: string;
  definition: string;
  rationale: string;
}

export const TABLES_DATA: TableDefinition[] = [
  {
    name: 'profiles',
    description: 'Extends Supabase auth.users with user account metadata, subscription tiers, stream limits, and billing status.',
    category: 'core',
    columns: [
      { name: 'id', type: 'UUID', nullable: false, isPrimaryKey: true, foreignKey: 'auth.users(id) ON DELETE CASCADE', description: 'Primary key tied 1:1 with Supabase Auth user ID' },
      { name: 'email', type: 'TEXT', nullable: false, description: 'User verified email address synced from auth.users' },
      { name: 'full_name', type: 'TEXT', nullable: true, description: 'Display name extracted from user metadata' },
      { name: 'avatar_url', type: 'TEXT', nullable: true, description: 'Profile picture avatar URL' },
      { name: 'role', type: 'user_role_enum', nullable: false, defaultValue: "'user'", description: "Role enum: 'user', 'admin', 'super_admin'" },
      { name: 'subscription_tier', type: 'subscription_tier_enum', nullable: false, defaultValue: "'free'", description: "Tiers: 'free' (3 days, 10h), 'basic' (1,200 BDT), 'pro' (4,000 BDT), 'business' (12,000 BDT)" },
      { name: 'subscription_status', type: 'subscription_status_enum', nullable: false, defaultValue: "'unpaid'", description: "Status: 'unpaid', 'pending', 'active', 'cancelled'" },
      { name: 'channel_limit', type: 'INTEGER', nullable: false, defaultValue: '1', description: 'Maximum channels allowed by plan tier (1 to 4)' },
      { name: 'video_limit', type: 'INTEGER', nullable: false, defaultValue: '1', description: 'Maximum video loops allowed by plan tier (1 to 4)' },
      { name: 'plan_tier', type: 'plan_tier_enum', nullable: false, defaultValue: "'starter'", description: "Legacy tier enum: 'free', 'starter', 'pro', 'enterprise'" },
      { name: 'max_concurrent_streams', type: 'INTEGER', nullable: false, defaultValue: '2', description: 'Maximum active 24/7 live streams allowed concurrently' },
      { name: 'max_bitrate_kbps', type: 'INTEGER', nullable: false, defaultValue: '6000', description: 'Maximum allowed audio/video ingestion bitrate' },
      { name: 'max_storage_gb', type: 'NUMERIC(6,2)', nullable: false, defaultValue: '10.00', description: 'Storage quota for loop video files in Supabase Storage' },
      { name: 'is_banned', type: 'BOOLEAN', nullable: false, defaultValue: 'FALSE', description: 'Admin suspension flag to block stream activation' },
      { name: 'created_at', type: 'TIMESTAMPTZ', nullable: false, defaultValue: 'now()', description: 'Account creation UTC timestamp' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', nullable: false, defaultValue: 'now()', description: 'Auto-updated via database trigger' }
    ]
  },
  {
    name: 'streams',
    description: 'Individual 24/7 stream configurations, YouTube RTMP keys, Cloudflare R2 video URLs, worker assignment, and health metrics.',
    category: 'streaming',
    columns: [
      { name: 'id', type: 'UUID', nullable: false, isPrimaryKey: true, defaultValue: 'gen_random_uuid()', description: 'Unique stream UUID' },
      { name: 'user_id', type: 'UUID', nullable: false, foreignKey: 'profiles(id) ON DELETE CASCADE', description: 'Stream owner reference' },
      { name: 'title', type: 'VARCHAR(255)', nullable: false, description: 'Title of the 24/7 live broadcast stream' },
      { name: 'description', type: 'TEXT', nullable: true, description: 'Stream metadata and notes' },
      { name: 'video_url', type: 'TEXT', nullable: false, description: 'Supabase Storage signed / public MP4 looping media URL' },
      { name: 'thumbnail_url', type: 'TEXT', nullable: true, description: 'Custom thumbnail cover image URL for the live stream' },
      { name: 'stream_key', type: 'TEXT', nullable: false, description: 'YouTube RTMP broadcast key (masked in UI for security)' },
      { name: 'rtmp_server_url', type: 'TEXT', nullable: false, defaultValue: "'rtmp://a.rtmp.youtube.com/live2'", description: 'YouTube primary RTMP ingestion gateway' },
      { name: 'orientation', type: 'VARCHAR(20)', nullable: false, defaultValue: "'horizontal'", description: "Stream aspect ratio: 'horizontal' (16:9 Standard) or 'vertical' (9:16 Shorts/Reels)" },
      { name: 'category', type: 'VARCHAR(50)', nullable: false, defaultValue: "'Entertainment'", description: "Standard YouTube stream category: Entertainment, Gaming, Music, Education, etc." },
      { name: 'audience', type: 'VARCHAR(30)', nullable: false, defaultValue: "'not_for_kids'", description: "Audience targeting: 'not_for_kids' or 'made_for_kids'" },
      { name: 'visibility', type: 'VARCHAR(20)', nullable: false, defaultValue: "'public'", description: "Visibility state: 'public', 'unlisted', 'private', or 'scheduled'" },
      { name: 'scheduled_for', type: 'TIMESTAMPTZ', nullable: true, description: 'Scheduled start date and time for scheduled live broadcasts' },
      { name: 'status', type: 'stream_status_enum', nullable: false, defaultValue: "'idle'", description: 'idle, queued, starting, live, reconnecting, stopping, failed' },
      { name: 'is_looping', type: 'BOOLEAN', nullable: false, defaultValue: 'TRUE', description: 'Seamless 24/7 loop flag (-stream_loop -1 in FFmpeg)' },
      { name: 'direct_copy_mode', type: 'BOOLEAN', nullable: false, defaultValue: 'TRUE', description: 'FFmpeg -c copy (zero CPU re-encoding lag & high VPS density)' },
      { name: 'restart_on_failure', type: 'BOOLEAN', nullable: false, defaultValue: 'TRUE', description: 'Auto-restart worker process on network or socket drops' },
      { name: 'max_auto_restarts', type: 'INTEGER', nullable: false, defaultValue: '15', description: 'Safety ceiling for consecutive restart loops' },
      { name: 'restart_count', type: 'INTEGER', nullable: false, defaultValue: '0', description: 'Current failure recovery retry counter' },
      { name: 'ffmpeg_pid', type: 'INTEGER', nullable: true, description: 'Operating system process ID of isolated child worker' },
      { name: 'worker_node_id', type: 'VARCHAR(64)', nullable: true, description: 'Worker host / container instance handling the stream' },
      { name: 'last_heartbeat', type: 'TIMESTAMPTZ', nullable: true, description: 'Periodic watchdog ping from the worker supervisor' },
      { name: 'uptime_seconds', type: 'BIGINT', nullable: false, defaultValue: '0', description: 'Cumulative active seconds since stream launch' },
      { name: 'current_bitrate_kbps', type: 'INTEGER', nullable: false, defaultValue: '0', description: 'Real-time measured outbound bitrate' },
      { name: 'fps', type: 'NUMERIC(5,2)', nullable: false, defaultValue: '0.00', description: 'Current streaming frames per second' },
      { name: 'cpu_usage_pct', type: 'NUMERIC(5,2)', nullable: false, defaultValue: '0.00', description: 'Isolated worker CPU percentage consumption' },
      { name: 'mem_usage_mb', type: 'NUMERIC(8,2)', nullable: false, defaultValue: '0.00', description: 'Isolated worker memory footprint in MB' },
      { name: 'logs', type: 'JSONB', nullable: false, defaultValue: "'[]'::jsonb", description: 'Recent structured stdout/stderr ring buffer' },
      { name: 'created_at', type: 'TIMESTAMPTZ', nullable: false, defaultValue: 'now()', description: 'Record creation timestamp' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', nullable: false, defaultValue: 'now()', description: 'Auto-updated via database trigger' }
    ]
  },
  {
    name: 'system_settings',
    description: 'Dynamic cluster power configuration, BullMQ worker concurrency, Redis cache TTL, and failover parameters for 1-Click Scaling.',
    category: 'system',
    columns: [
      { name: 'id', type: 'VARCHAR(64)', nullable: false, isPrimaryKey: true, defaultValue: "'primary_cluster'", description: 'Cluster identifier singleton' },
      { name: 'cluster_name', type: 'VARCHAR(100)', nullable: false, defaultValue: "'Hetzner-Production-Cluster-01'", description: 'Human-readable cluster tag' },
      { name: 'cluster_mode', type: 'VARCHAR(32)', nullable: false, defaultValue: "'production'", description: "Cluster status: 'production', 'drain', 'maintenance'" },
      { name: 'worker_concurrency', type: 'INTEGER', nullable: false, defaultValue: '16', description: 'BullMQ active worker thread capacity per node (1-Click Scaled)' },
      { name: 'max_global_streams', type: 'INTEGER', nullable: false, defaultValue: '120', description: 'Hard global ceiling for concurrent live streams across VPS' },
      { name: 'bullmq_job_timeout_ms', type: 'INTEGER', nullable: false, defaultValue: '60000', description: 'Heartbeat deadline before job considered stalled' },
      { name: 'bullmq_rate_limit_max', type: 'INTEGER', nullable: false, defaultValue: '25', description: 'Rate limiter tokens for stream initialization' },
      { name: 'redis_cache_enabled', type: 'BOOLEAN', nullable: false, defaultValue: 'TRUE', description: 'Toggle Redis memory caching for state lookups' },
      { name: 'redis_cache_ttl_seconds', type: 'INTEGER', nullable: false, defaultValue: '300', description: 'Dynamic TTL for stream status caching' },
      { name: 'heartbeat_timeout_seconds', type: 'INTEGER', nullable: false, defaultValue: '25', description: 'Crash detection threshold for dead FFmpeg worker processes' },
      { name: 'enforce_direct_copy_mode', type: 'BOOLEAN', nullable: false, defaultValue: 'TRUE', description: 'Global safety rule to disallow heavy CPU transcoding' },
      { name: 'supabase_storage_bucket', type: 'VARCHAR(128)', nullable: false, defaultValue: "'stream-assets'", description: 'Target Supabase Storage bucket for video loops (replaces R2)' },
      { name: 'last_scaled_at', type: 'TIMESTAMPTZ', nullable: false, defaultValue: 'now()', description: 'Timestamp of latest 1-Click admin scaling event' },
      { name: 'updated_by', type: 'UUID', nullable: true, foreignKey: 'profiles(id) ON DELETE SET NULL', description: 'Admin user who executed the latest scaling update' }
    ]
  },
  {
    name: 'stream_logs',
    description: 'High-volume diagnostic log events partitioned by stream for real-time monitoring and crash analysis.',
    category: 'logging',
    columns: [
      { name: 'id', type: 'BIGINT', nullable: false, isPrimaryKey: true, defaultValue: 'GENERATED ALWAYS AS IDENTITY', description: 'Sequential high-performance log ID' },
      { name: 'stream_id', type: 'UUID', nullable: false, foreignKey: 'streams(id) ON DELETE CASCADE', description: 'Referenced stream record' },
      { name: 'level', type: 'VARCHAR(16)', nullable: false, defaultValue: "'info'", description: "'info', 'warn', 'error', 'ffmpeg'" },
      { name: 'message', type: 'TEXT', nullable: false, description: 'Parsed stdout/stderr log entry from worker' },
      { name: 'metadata', type: 'JSONB', nullable: true, defaultValue: "'{}'::jsonb", description: 'Structured telemetry metadata (fps, bitrate, drops)' },
      { name: 'created_at', type: 'TIMESTAMPTZ', nullable: false, defaultValue: 'now()', description: 'Timestamp of log event emission' }
    ]
  },
  {
    name: 'tutorial_videos',
    description: 'Enterprise guide and tutorial videos on 24/7 continuous broadcasting, YouTube RTMP setup, and direct copy optimization with admin RBAC management.',
    category: 'system',
    columns: [
      { name: 'id', type: 'TEXT', nullable: false, isPrimaryKey: true, description: 'Unique tutorial record ID' },
      { name: 'title', type: 'VARCHAR(255)', nullable: false, description: 'Tutorial guide video headline' },
      { name: 'description', type: 'TEXT', nullable: true, description: 'Detailed guide instructions and timestamp notes' },
      { name: 'video_url', type: 'TEXT', nullable: false, description: 'Direct YouTube watch URL or embedded guide video link' },
      { name: 'youtube_id', type: 'VARCHAR(50)', nullable: true, description: 'Extracted YouTube 11-char video ID for embed player' },
      { name: 'category', type: 'VARCHAR(50)', nullable: false, defaultValue: "'getting_started'", description: "'getting_started', 'youtube_setup', 'stream_keys', 'troubleshooting', 'pro_tips'" },
      { name: 'duration_minutes', type: 'INTEGER', nullable: false, defaultValue: '5', description: 'Estimated watching duration in minutes' },
      { name: 'thumbnail_url', type: 'TEXT', nullable: true, description: 'Poster image preview or YouTube auto-thumbnail' },
      { name: 'created_by', type: 'TEXT', nullable: false, defaultValue: "'Admin'", description: 'Administrator author display name' },
      { name: 'created_at', type: 'TIMESTAMPTZ', nullable: false, defaultValue: 'now()', description: 'Creation timestamp' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', nullable: false, defaultValue: 'now()', description: 'Last updated timestamp' }
    ]
  }
];

export const RLS_POLICIES_DATA: RlsPolicy[] = [
  {
    table: 'profiles',
    name: 'profiles_select_policy',
    action: 'SELECT',
    roles: 'authenticated',
    definition: 'auth.uid() = id OR public.is_admin(auth.uid())',
    rationale: 'Ensures standard tenants can only inspect their own account profile and limits, while platform admins retain fleet-wide visibility.'
  },
  {
    table: 'profiles',
    name: 'profiles_update_self_policy',
    action: 'UPDATE',
    roles: 'authenticated',
    definition: 'auth.uid() = id AND role = CURRENT AND max_concurrent_streams = CURRENT',
    rationale: 'Guarantees users can update avatar and display name, but CANNOT self-escalate roles or artificially increase their stream limits.'
  },
  {
    table: 'profiles',
    name: 'profiles_admin_update_policy',
    action: 'UPDATE',
    roles: 'authenticated (admin)',
    definition: 'public.is_admin(auth.uid())',
    rationale: 'Gives Super Admins unrestricted capability to adjust tier limits, ban abusers, or override quotas.'
  },
  {
    table: 'streams',
    name: 'streams_select_policy',
    action: 'SELECT',
    roles: 'authenticated',
    definition: 'auth.uid() = user_id OR public.is_admin(auth.uid())',
    rationale: 'Guarantees complete multi-tenant isolation. No user can view another customer streams or sensitive YouTube stream keys.'
  },
  {
    table: 'streams',
    name: 'streams_insert_policy',
    action: 'INSERT',
    roles: 'authenticated',
    definition: 'auth.uid() = user_id AND NOT (SELECT is_banned FROM public.profiles WHERE id = auth.uid())',
    rationale: 'Validates that streams are created strictly under the authenticated identity and verifies active unbanned account status.'
  },
  {
    table: 'streams',
    name: 'streams_update_policy',
    action: 'UPDATE',
    roles: 'authenticated',
    definition: 'auth.uid() = user_id OR public.is_admin(auth.uid())',
    rationale: 'Allows users to update title, RTMP keys, and loop settings for their streams, while admins can halt or restart rogue streams.'
  },
  {
    table: 'streams',
    name: 'streams_delete_policy',
    action: 'DELETE',
    roles: 'authenticated',
    definition: 'auth.uid() = user_id OR public.is_admin(auth.uid())',
    rationale: 'Enables users to safely tear down their streams, triggering cascading deletion of child log entries.'
  },
  {
    table: 'system_settings',
    name: 'system_settings_select_policy',
    action: 'SELECT',
    roles: 'authenticated',
    definition: "auth.role() = 'authenticated'",
    rationale: 'Allows the frontend dashboard to display cluster operational status and capacity limits to signed-in users.'
  },
  {
    table: 'system_settings',
    name: 'system_settings_admin_update_policy',
    action: 'UPDATE',
    roles: 'authenticated (admin)',
    definition: 'public.is_admin(auth.uid())',
    rationale: 'Enforces strict permission control so ONLY authenticated Administrators can trigger 1-Click Dynamic Scaling updates.'
  },
  {
    table: 'stream_logs',
    name: 'stream_logs_select_policy',
    action: 'SELECT',
    roles: 'authenticated',
    definition: 'EXISTS (SELECT 1 FROM public.streams s WHERE s.id = stream_logs.stream_id AND (s.user_id = auth.uid() OR public.is_admin(auth.uid())))',
    rationale: 'Protects stream log streams and FFmpeg diagnostic output from unauthorized cross-tenant inspection.'
  },
  {
    table: 'tutorial_videos',
    name: 'tutorial_videos_select_policy',
    action: 'SELECT',
    roles: 'authenticated, anon',
    definition: 'TRUE',
    rationale: 'Allows all registered and visiting creators to watch tutorial guides on setting up 24/7 continuous broadcasts and stream keys.'
  },
  {
    table: 'tutorial_videos',
    name: 'tutorial_videos_admin_write_policy',
    action: 'ALL',
    roles: 'authenticated (admin)',
    definition: 'public.is_admin(auth.uid())',
    rationale: 'Enforces strict role-based access control so only platform administrators can create, edit, or delete tutorial guides.'
  }
];
