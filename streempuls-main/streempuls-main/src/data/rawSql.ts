export const SUPABASE_SQL_DDL = `-- ============================================================================
-- 24/7 YOUTUBE LIVE STREAMING SAAS PLATFORM - PRODUCTION SUPABASE DDL SCHEMA
-- Stack: Supabase (PostgreSQL 15+) + Auth + Storage + BullMQ + Redis + FFmpeg (-c copy)
-- Storage: Supabase Storage Bucket ('stream-assets') replaces external R2 storage
-- Architecture: Zero-lag Isolated Node.js Workers & 1-Click Dynamic Scaling
-- ============================================================================

-- 1. EXTENSIONS & SETUP
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. ENUMS & DOMAINS
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE plan_tier_enum AS ENUM ('free', 'starter', 'pro', 'enterprise');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE subscription_tier_enum AS ENUM ('free', 'basic', 'pro', 'business');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE subscription_status_enum AS ENUM ('pending', 'unpaid', 'active', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE stream_status_enum AS ENUM (
        'idle',         -- Stream registered, waiting for trigger
        'queued',       -- Enqueued in BullMQ
        'starting',     -- Isolated FFmpeg worker spawning
        'live',         -- Active 24/7 RTMP broadcast to YouTube
        'reconnecting', -- Network hiccup / YouTube buffer recovery
        'stopping',     -- Graceful termination requested
        'failed'        -- Worker exited with unrecoverable error
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('user', 'admin', 'super_admin');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 3. TABLE: profiles
-- User accounts, plan tiers, stream limits, and billing quotas.
-- Linked directly to Supabase Auth (auth.users).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    role user_role_enum DEFAULT 'user'::user_role_enum NOT NULL,
    plan_tier plan_tier_enum DEFAULT 'starter'::plan_tier_enum NOT NULL,
    
    -- Subscription Columns (4 Required Tiers & Billing Status)
    subscription_tier subscription_tier_enum DEFAULT 'free'::subscription_tier_enum NOT NULL,
    subscription_status subscription_status_enum DEFAULT 'unpaid'::subscription_status_enum NOT NULL,
    
    -- Plan Tier Limits (Enforced on Streaming Dashboard)
    -- Free: 3 days, 10h limit, 1 channel, 1 video, watermark
    -- Basic (1,200 BDT): 1 channel, 1 video, non-stop, 100% brand-free
    -- Pro (4,000 BDT): 2 channels, 2 videos, non-stop, 100% brand-free
    -- Business (12,000 BDT): 4 channels, 4 videos, non-stop, 100% brand-free
    channel_limit INTEGER DEFAULT 1 NOT NULL,
    video_limit INTEGER DEFAULT 1 NOT NULL,
    duration_days INTEGER DEFAULT 3 NOT NULL,
    hour_limit INTEGER DEFAULT 10,
    has_watermark BOOLEAN DEFAULT TRUE NOT NULL,
    is_brand_free BOOLEAN DEFAULT FALSE NOT NULL,
    
    -- Resource & Concurrency Quotas
    max_concurrent_streams INTEGER DEFAULT 2 NOT NULL CHECK (max_concurrent_streams >= 0),
    max_bitrate_kbps INTEGER DEFAULT 6000 NOT NULL CHECK (max_bitrate_kbps >= 1000),
    max_storage_gb NUMERIC(6, 2) DEFAULT 10.00 NOT NULL CHECK (max_storage_gb >= 0),
    
    -- Account Flags
    is_banned BOOLEAN DEFAULT FALSE NOT NULL,
    custom_domain_allowed BOOLEAN DEFAULT FALSE NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================================
-- 4. TABLE: streams
-- User stream configurations, Cloudflare R2 video URLs, YouTube RTMP keys,
-- isolated worker telemetry, FFmpeg PID, uptime, and dynamic status.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- Stream Identity & Metadata
    title VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Video Source & YouTube Ingestion Target
    video_url TEXT NOT NULL, -- Direct MP4 / Cloudflare R2 presigned / S3 URL
    thumbnail_url TEXT, -- Custom broadcast preview cover image URL or uploaded asset
    stream_key TEXT NOT NULL, -- YouTube RTMP Live Stream Key (masked in UI)
    rtmp_server_url TEXT DEFAULT 'rtmp://a.rtmp.youtube.com/live2' NOT NULL,
    
    -- 24/7 Engine Configuration & Orientation Layout
    orientation VARCHAR(20) DEFAULT 'horizontal' NOT NULL CHECK (orientation IN ('horizontal', 'vertical')), -- 'horizontal' (16:9 Standard) or 'vertical' (9:16 Shorts/Reels)
    category VARCHAR(50) DEFAULT 'Entertainment' NOT NULL, -- Standard YouTube category (Gaming, Music, Education, etc.)
    audience VARCHAR(30) DEFAULT 'not_for_kids' NOT NULL CHECK (audience IN ('not_for_kids', 'made_for_kids')), -- YouTube COPPA compliance targeting
    visibility VARCHAR(20) DEFAULT 'public' NOT NULL CHECK (visibility IN ('public', 'unlisted', 'private', 'scheduled')), -- Broadcast discovery state
    scheduled_for TIMESTAMPTZ, -- Optional scheduled live broadcast start time
    is_looping BOOLEAN DEFAULT TRUE NOT NULL, -- Continuous seamless 24/7 loop
    restart_on_failure BOOLEAN DEFAULT TRUE NOT NULL,
    max_auto_restarts INTEGER DEFAULT 15 NOT NULL,
    restart_count INTEGER DEFAULT 0 NOT NULL,
    direct_copy_mode BOOLEAN DEFAULT TRUE NOT NULL, -- FFmpeg -c copy (Zero CPU / 0 transcoding lag)
    
    -- Execution State & Telemetry
    status stream_status_enum DEFAULT 'idle'::stream_status_enum NOT NULL,
    ffmpeg_pid INTEGER, -- Isolated OS process PID
    worker_node_id VARCHAR(64), -- Worker instance ID handling this process
    last_heartbeat TIMESTAMPTZ, -- Zero-lag heartbeat watchdog ping
    
    -- Metrics
    uptime_seconds BIGINT DEFAULT 0 NOT NULL,
    current_bitrate_kbps INTEGER DEFAULT 0 NOT NULL,
    fps NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    cpu_usage_pct NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    mem_usage_mb NUMERIC(8, 2) DEFAULT 0.00 NOT NULL,
    
    -- Diagnostics
    last_error TEXT,
    logs JSONB DEFAULT '[]'::jsonb NOT NULL, -- Last 50 structured stdout/stderr lines
    
    -- Timestamps
    last_started_at TIMESTAMPTZ,
    last_stopped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================================
-- 5. TABLE: system_settings
-- Dynamic system power configuration, worker concurrency, and Redis caching.
-- Allows 1-Click Admin Dynamic Scaling without redeploying containers or code!
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.system_settings (
    id VARCHAR(64) PRIMARY KEY DEFAULT 'primary_cluster',
    cluster_name VARCHAR(100) DEFAULT 'Hetzner-Production-Cluster-01' NOT NULL,
    cluster_mode VARCHAR(32) DEFAULT 'production' NOT NULL, -- 'production', 'drain', 'maintenance'
    
    -- 1-Click Dynamic Worker Scaling (Directly read by BullMQ supervisors)
    worker_concurrency INTEGER DEFAULT 16 NOT NULL CHECK (worker_concurrency BETWEEN 1 AND 256),
    max_global_streams INTEGER DEFAULT 120 NOT NULL CHECK (max_global_streams >= 1),
    bullmq_job_timeout_ms INTEGER DEFAULT 60000 NOT NULL,
    bullmq_rate_limit_max INTEGER DEFAULT 25 NOT NULL,
    bullmq_rate_limit_duration_ms INTEGER DEFAULT 1000 NOT NULL,
    
    -- Dynamic Redis Cache Settings
    redis_cache_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    redis_cache_ttl_seconds INTEGER DEFAULT 300 NOT NULL CHECK (redis_cache_ttl_seconds >= 10),
    redis_metrics_sync_interval_ms INTEGER DEFAULT 5000 NOT NULL,
    
    -- Crash-Proof Watchdog Settings
    heartbeat_timeout_seconds INTEGER DEFAULT 25 NOT NULL CHECK (heartbeat_timeout_seconds >= 5),
    auto_failover_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    enforce_direct_copy_mode BOOLEAN DEFAULT TRUE NOT NULL, -- Enforces -c copy across all non-enterprise streams
    
    -- Supabase Storage Configuration (Replaces Cloudflare R2)
    supabase_storage_bucket VARCHAR(128) DEFAULT 'stream-assets' NOT NULL,
    supabase_storage_public_url TEXT DEFAULT 'https://wkchgdchgeormxvvlude.supabase.co/storage/v1/object/public/stream-assets' NOT NULL,
    storage_signed_url_expiry_seconds INTEGER DEFAULT 86400 NOT NULL,
    
    -- Audit & Change Control
    last_scaled_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed default primary cluster settings singleton
INSERT INTO public.system_settings (
    id, cluster_name, worker_concurrency, max_global_streams,
    redis_cache_enabled, redis_cache_ttl_seconds, enforce_direct_copy_mode,
    supabase_storage_bucket
) VALUES (
    'primary_cluster', 'Hetzner-Production-Cluster-01', 16, 120,
    TRUE, 300, TRUE,
    'stream-assets'
) ON CONFLICT (id) DO UPDATE SET
    supabase_storage_bucket = 'stream-assets';

-- ============================================================================
-- 6. TABLE: stream_logs (High-Volume Diagnostic Partition / Stream History)
-- Append-only log stream for isolated worker stdout/stderr parsing
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stream_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stream_id UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
    level VARCHAR(16) DEFAULT 'info' NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ============================================================================
-- 7. PERFORMANCE INDEXES
-- Optimized for high-throughput polling, BullMQ schedulers, and dashboard lookups
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_plan_tier ON public.profiles(plan_tier);

CREATE INDEX IF NOT EXISTS idx_streams_user_id ON public.streams(user_id);
CREATE INDEX IF NOT EXISTS idx_streams_status ON public.streams(status);
CREATE INDEX IF NOT EXISTS idx_streams_worker_node ON public.streams(worker_node_id);
CREATE INDEX IF NOT EXISTS idx_streams_last_heartbeat ON public.streams(last_heartbeat) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_streams_user_status ON public.streams(user_id, status);

CREATE INDEX IF NOT EXISTS idx_stream_logs_stream_id_created ON public.stream_logs(stream_id, created_at DESC);

-- ============================================================================
-- 8. DATABASE FUNCTIONS & AUTOMATION TRIGGERS
-- ============================================================================

-- Function: Automatic timestamp updater
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check user role helper (Bypasses recursive RLS lookups)
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_role user_role_enum;
BEGIN
    SELECT role INTO user_role FROM public.profiles WHERE id = user_id;
    RETURN (user_role = 'admin' OR user_role = 'super_admin');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function: Automatic profile creation when a user registers via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        avatar_url,
        role,
        plan_tier,
        max_concurrent_streams,
        max_bitrate_kbps
    ) VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
        'user'::user_role_enum,
        'starter'::plan_tier_enum,
        2,
        6000
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Bind new user creation on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger: Updated_at auto-management
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_streams_updated_at ON public.streams;
CREATE TRIGGER trg_streams_updated_at
    BEFORE UPDATE ON public.streams
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_system_settings_updated_at ON public.system_settings;
CREATE TRIGGER trg_system_settings_updated_at
    BEFORE UPDATE ON public.system_settings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Function & Trigger: Enforce user stream limits at database level before stream activation
CREATE OR REPLACE FUNCTION public.enforce_stream_quota()
RETURNS TRIGGER AS $$
DECLARE
    current_active_count INTEGER;
    user_max_limit INTEGER;
    user_is_banned BOOLEAN;
BEGIN
    SELECT max_concurrent_streams, is_banned
    INTO user_max_limit, user_is_banned
    FROM public.profiles
    WHERE id = NEW.user_id;

    IF user_is_banned THEN
        RAISE EXCEPTION 'Account is suspended. Unable to schedule or start streams.';
    END IF;

    IF (NEW.status IN ('queued', 'starting', 'live') AND (OLD IS NULL OR OLD.status NOT IN ('queued', 'starting', 'live'))) THEN
        SELECT COUNT(*)
        INTO current_active_count
        FROM public.streams
        WHERE user_id = NEW.user_id
          AND status IN ('queued', 'starting', 'live')
          AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

        IF current_active_count >= user_max_limit THEN
            RAISE EXCEPTION 'Plan limit exceeded: You have % active streams, maximum allowed for your plan is %.', current_active_count, user_max_limit;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_stream_quota ON public.streams;
CREATE TRIGGER trg_enforce_stream_quota
    BEFORE INSERT OR UPDATE ON public.streams
    FOR EACH ROW EXECUTE FUNCTION public.enforce_stream_quota();

-- ============================================================================
-- 9. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_logs ENABLE ROW LEVEL SECURITY;

-- RLS: profiles
CREATE POLICY "profiles_select_policy"
    ON public.profiles
    FOR SELECT
    USING (
        auth.uid() = id
        OR public.is_admin(auth.uid())
    );

CREATE POLICY "profiles_update_self_policy"
    ON public.profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id
        AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
        AND max_concurrent_streams = (SELECT max_concurrent_streams FROM public.profiles WHERE id = auth.uid())
        AND plan_tier = (SELECT plan_tier FROM public.profiles WHERE id = auth.uid())
    );

CREATE POLICY "profiles_admin_update_policy"
    ON public.profiles
    FOR UPDATE
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

-- RLS: streams
CREATE POLICY "streams_select_policy"
    ON public.streams
    FOR SELECT
    USING (
        auth.uid() = user_id
        OR public.is_admin(auth.uid())
    );

CREATE POLICY "streams_insert_policy"
    ON public.streams
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND NOT (SELECT is_banned FROM public.profiles WHERE id = auth.uid())
    );

CREATE POLICY "streams_update_policy"
    ON public.streams
    FOR UPDATE
    USING (
        auth.uid() = user_id
        OR public.is_admin(auth.uid())
    )
    WITH CHECK (
        auth.uid() = user_id
        OR public.is_admin(auth.uid())
    );

CREATE POLICY "streams_delete_policy"
    ON public.streams
    FOR DELETE
    USING (
        auth.uid() = user_id
        OR public.is_admin(auth.uid())
    );

-- RLS: system_settings
CREATE POLICY "system_settings_select_policy"
    ON public.system_settings
    FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "system_settings_admin_update_policy"
    ON public.system_settings
    FOR UPDATE
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

-- RLS: stream_logs
CREATE POLICY "stream_logs_select_policy"
    ON public.stream_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.streams s
            WHERE s.id = stream_logs.stream_id
              AND (s.user_id = auth.uid() OR public.is_admin(auth.uid()))
        )
    );

CREATE POLICY "stream_logs_service_insert_policy"
    ON public.stream_logs
    FOR INSERT
    WITH CHECK (TRUE);

-- ============================================================================
-- 10. SUPABASE STORAGE BUCKET INITIALIZATION & SECURITY POLICIES
-- Fully replaces Cloudflare R2: Stores MP4 video loops directly in Supabase Storage
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'stream-assets',
    'stream-assets',
    TRUE,
    5368709120, -- 5GB max file size for high-bitrate MP4 loops
    ARRAY['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm']
) ON CONFLICT (id) DO UPDATE SET
    public = TRUE,
    file_size_limit = 5368709120,
    allowed_mime_types = ARRAY['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'];

-- Storage RLS: Public read access for FFmpeg streaming workers & player previews
CREATE POLICY "Public Access to Stream Assets"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'stream-assets');

-- Storage RLS: Authenticated users can upload MP4 loop videos
CREATE POLICY "Authenticated Users Can Upload Video Loops"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'stream-assets'
        AND auth.role() = 'authenticated'
    );

-- Storage RLS: Users can delete their own media files
CREATE POLICY "Users Can Delete Own Media Assets"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'stream-assets'
        AND (auth.uid() = owner OR public.is_admin(auth.uid()))
    );

-- ============================================================================
-- 11. TUTORIAL VIDEOS TABLE (ADMIN-MANAGED GUIDES & HOW-TO BROADCASTING)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tutorial_videos (
    id TEXT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    video_url TEXT NOT NULL,
    youtube_id VARCHAR(50),
    category VARCHAR(50) DEFAULT 'getting_started',
    duration_minutes INT DEFAULT 5,
    thumbnail_url TEXT,
    created_by TEXT DEFAULT 'Admin',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tutorial_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read Tutorial Videos"
    ON public.tutorial_videos FOR SELECT
    USING (TRUE);

CREATE POLICY "Admin Manage Tutorial Videos"
    ON public.tutorial_videos FOR ALL
    USING (public.is_admin(auth.uid()));
`;
