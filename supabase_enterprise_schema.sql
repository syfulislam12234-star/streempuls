-- ============================================================================
-- StreamPulse Enterprise PostgreSQL & Supabase Database Migration
-- Covers:
-- 1. User Profiles & Subscriptions (with Expiry Tracking & Referral Balances)
-- 2. Referral & Affiliate Tracking
-- 3. Promo Codes & Discount Coupons
-- 4. In-App Automated Expiry & Renewal Notifications
-- 5. Multi-Platform Multi-Casting Stream Destinations (Restreaming)
-- 6. Real-Time Telemetry & Health Metrics Logs
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. PROFILES TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  subscription_tier VARCHAR(20) DEFAULT 'free' CHECK (subscription_tier IN ('free', 'basic', 'pro', 'business')),
  subscription_status VARCHAR(20) DEFAULT 'unpaid' CHECK (subscription_status IN ('pending', 'unpaid', 'active', 'cancelled', 'expired')),
  channel_limit INT DEFAULT 1,
  video_limit INT DEFAULT 1,
  duration_days INT DEFAULT 3,
  hour_limit INT DEFAULT 10,
  has_watermark BOOLEAN DEFAULT TRUE,
  is_brand_free BOOLEAN DEFAULT FALSE,
  price_bdt NUMERIC(10, 2) DEFAULT 0,
  expires_at TIMESTAMPTZ,
  referral_code VARCHAR(30) UNIQUE,
  referred_by_code VARCHAR(30),
  reward_credits_bdt NUMERIC(10, 2) DEFAULT 0,
  trial_days_bonus INT DEFAULT 0,
  -- Custom API authentication credentials. These hashes are never returned to clients.
  password_hash TEXT,
  password_salt TEXT,
  auth_token_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade existing profiles without replacing the table or its application data.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_salt TEXT,
  ADD COLUMN IF NOT EXISTS auth_token_hash TEXT;

-- Index for speedy lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_ref_code ON public.profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_profiles_sub_status ON public.profiles(subscription_status);
CREATE INDEX IF NOT EXISTS idx_profiles_expires_at ON public.profiles(expires_at);

-- ----------------------------------------------------------------------------
-- 1b. LEGACY USERS TABLE
-- Retained for compatibility with existing installs; auth now reads/writes
-- profiles and the migration below copies existing records. Never store the
-- submitted plaintext password.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role VARCHAR(20) DEFAULT 'user' NOT NULL,
  admin BOOLEAN NOT NULL DEFAULT FALSE,
  subscription_tier VARCHAR(20) DEFAULT 'free' NOT NULL,
  subscription_status VARCHAR(20) DEFAULT 'unpaid' NOT NULL,
  business BOOLEAN NOT NULL DEFAULT FALSE,
  channel_limit INT DEFAULT 1 NOT NULL,
  video_limit INT DEFAULT 1 NOT NULL,
  duration_days INT DEFAULT 3 NOT NULL,
  hour_limit INT DEFAULT 10 NOT NULL,
  has_watermark BOOLEAN DEFAULT TRUE NOT NULL,
  is_brand_free BOOLEAN DEFAULT FALSE NOT NULL,
  price_bdt NUMERIC(10, 2) DEFAULT 0 NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  auth_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  referral_code VARCHAR(30),
  reward_credits_bdt NUMERIC(10, 2) DEFAULT 0 NOT NULL,
  trial_days_bonus INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Upgrade pre-existing users tables in place. The custom-auth API creates its
-- own account IDs, so public.users.id must not require a matching auth.users
-- row. Existing UUID columns remain valid because the API IDs are UUIDs.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS id TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(20) DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS business BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS channel_limit INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS video_limit INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS duration_days INT DEFAULT 3,
  ADD COLUMN IF NOT EXISTS hour_limit INT DEFAULT 10,
  ADD COLUMN IF NOT EXISTS has_watermark BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_brand_free BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS price_bdt NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_salt TEXT,
  ADD COLUMN IF NOT EXISTS auth_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS referred_by_code VARCHAR(30),
  ADD COLUMN IF NOT EXISTS reward_credits_bdt NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_days_bonus INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
DECLARE
  id_attnum SMALLINT;
  fk RECORD;
BEGIN
  SELECT attnum INTO id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.users'::regclass AND attname = 'id' AND NOT attisdropped;

  FOR fk IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND conkey @> ARRAY[id_attnum]
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', fk.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_id_upsert_uidx ON public.users(id);

-- Move legacy custom-auth accounts into profiles so new auth reads and writes
-- use the application profile table. Existing profile rows take precedence.
INSERT INTO public.profiles (
  id, email, full_name, role, subscription_tier, subscription_status,
  channel_limit, video_limit, duration_days, hour_limit, has_watermark,
  is_brand_free, price_bdt, expires_at, referral_code, referred_by_code,
  reward_credits_bdt, trial_days_bonus, password_hash, password_salt, auth_token_hash,
  created_at, updated_at
)
SELECT
  id, email, full_name, CASE WHEN role = 'admin' THEN 'admin' ELSE 'user' END,
  subscription_tier, subscription_status, channel_limit, video_limit,
  duration_days, hour_limit, has_watermark, is_brand_free, price_bdt,
  expires_at, referral_code, referred_by_code, reward_credits_bdt,
  trial_days_bonus, password_hash, password_salt, auth_token_hash, created_at, updated_at
FROM public.users
ON CONFLICT DO NOTHING;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users FROM anon, authenticated;
GRANT ALL ON TABLE public.users TO service_role;

-- ----------------------------------------------------------------------------
-- 1c. STREAMS TABLE
-- Worker/API persistence uses a service-role Supabase client. TEXT identifiers
-- match the custom-auth account IDs and local stream catalog used by backend.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.streams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  video_url TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  rtmp_server_url TEXT NOT NULL DEFAULT 'rtmp://a.rtmp.youtube.com/live2',
  is_looping BOOLEAN NOT NULL DEFAULT TRUE,
  direct_copy_mode BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'idle',
  ffmpeg_pid INTEGER,
  worker_node_id TEXT,
  last_heartbeat TIMESTAMPTZ,
  uptime_seconds BIGINT NOT NULL DEFAULT 0,
  current_bitrate_kbps INTEGER NOT NULL DEFAULT 0,
  fps NUMERIC(5, 2) NOT NULL DEFAULT 0,
  cpu_usage_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  mem_usage_mb NUMERIC(8, 2) NOT NULL DEFAULT 0,
  last_error TEXT,
  logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_started_at TIMESTAMPTZ,
  last_stopped_at TIMESTAMPTZ,
  orientation VARCHAR(20) NOT NULL DEFAULT 'horizontal',
  category VARCHAR(50) NOT NULL DEFAULT 'Entertainment',
  audience VARCHAR(30) NOT NULL DEFAULT 'not_for_kids',
  thumbnail_url TEXT,
  visibility VARCHAR(20) NOT NULL DEFAULT 'public',
  scheduled_for TIMESTAMPTZ,
  normalized BOOLEAN NOT NULL DEFAULT FALSE,
  normalization_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  normalized_object_key TEXT,
  normalization_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bring an existing streams table up to the worker persistence contract too.
ALTER TABLE public.streams
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS rtmp_server_url TEXT NOT NULL DEFAULT 'rtmp://a.rtmp.youtube.com/live2',
  ADD COLUMN IF NOT EXISTS is_looping BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS direct_copy_mode BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS ffmpeg_pid INTEGER,
  ADD COLUMN IF NOT EXISTS worker_node_id TEXT,
  ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS uptime_seconds BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_bitrate_kbps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fps NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cpu_usage_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mem_usage_mb NUMERIC(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_stopped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_streams_user_id ON public.streams(user_id);
CREATE INDEX IF NOT EXISTS idx_streams_status ON public.streams(status);
CREATE INDEX IF NOT EXISTS idx_streams_user_status ON public.streams(user_id, status);

-- ----------------------------------------------------------------------------
-- 2. USER REFERRALS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_code VARCHAR(30) NOT NULL,
  reward_type VARCHAR(50) NOT NULL CHECK (reward_type IN ('trial_extension_days', 'discount_credits')),
  reward_value INT NOT NULL, -- e.g. 3 (days) or 200 (BDT credits)
  status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'claimed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.user_referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_invite_code ON public.user_referrals(invite_code);

-- ----------------------------------------------------------------------------
-- 3. PROMO CODES & COUPONS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percent', 'fixed_bdt')),
  discount_value NUMERIC(10, 2) NOT NULL,
  applicable_tiers TEXT[] DEFAULT '{free,basic,pro,business}',
  max_uses INT DEFAULT 500,
  times_used INT DEFAULT 0,
  valid_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);

-- Seed default coupons
INSERT INTO public.coupons (code, discount_type, discount_value, applicable_tiers, max_uses, times_used, is_active)
VALUES
  ('PULSE20', 'percent', 20.00, '{basic,pro,business}', 1000, 14, TRUE),
  ('CREATOR500', 'fixed_bdt', 500.00, '{basic,pro,business}', 500, 28, TRUE),
  ('VIP30', 'percent', 30.00, '{pro,business}', 200, 8, TRUE)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. IN-APP AUTOMATED NOTIFICATIONS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('expiry_24h', 'expiry_2h', 'expired', 'referral_reward', 'discount_alert', 'system')),
  is_read BOOLEAN DEFAULT FALSE,
  action_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read);

-- ----------------------------------------------------------------------------
-- 4b. STREAMS TABLE ORIENTATION, CATEGORY, AUDIENCE, THUMBNAIL & VISIBILITY MIGRATION
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.streams 
  ADD COLUMN IF NOT EXISTS orientation VARCHAR(20) DEFAULT 'horizontal' CHECK (orientation IN ('horizontal', 'vertical')),
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Entertainment',
  ADD COLUMN IF NOT EXISTS audience VARCHAR(30) DEFAULT 'not_for_kids' CHECK (audience IN ('not_for_kids', 'made_for_kids')),
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private', 'scheduled')),
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 5. MULTI-PLATFORM MULTI-CAST DESTINATIONS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stream_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id TEXT NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  platform VARCHAR(30) NOT NULL CHECK (platform IN ('youtube', 'twitch', 'kick', 'custom')),
  destination_label TEXT NOT NULL,
  rtmp_server_url TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_destinations_stream ON public.stream_destinations(stream_id);

-- ----------------------------------------------------------------------------
-- 6. REAL-TIME TELEMETRY LOGS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stream_telemetry_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id TEXT NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  bitrate_kbps INT NOT NULL,
  fps NUMERIC(5, 2) NOT NULL,
  dropped_frames INT DEFAULT 0,
  cpu_pct NUMERIC(5, 2) NOT NULL,
  mem_mb NUMERIC(6, 2) NOT NULL,
  health_status VARCHAR(20) DEFAULT 'excellent',
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_stream_time ON public.stream_telemetry_logs(stream_id, recorded_at DESC);

-- ----------------------------------------------------------------------------
-- 7. TUTORIAL VIDEOS TABLE
-- Storing guide videos with view access for all and admin-only write permissions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tutorial_videos (
  id TEXT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  video_url TEXT NOT NULL,
  youtube_id VARCHAR(50),
  category VARCHAR(50) DEFAULT 'getting_started' CHECK (category IN ('getting_started', 'youtube_setup', 'stream_keys', 'troubleshooting', 'pro_tips')),
  duration_minutes INT DEFAULT 5,
  thumbnail_url TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tutorial_category ON public.tutorial_videos(category);

-- ----------------------------------------------------------------------------
-- Row-Level Security (RLS) Rules for Supabase
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stream_telemetry_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutorial_videos ENABLE ROW LEVEL SECURITY;

-- API/worker operations use the service-role key and do not depend on end-user
-- RLS policies. Do not configure FORCE ROW LEVEL SECURITY on these tables.
REVOKE ALL ON TABLE public.streams, public.stream_destinations FROM anon, authenticated;
GRANT ALL ON TABLE public.streams, public.stream_destinations TO service_role;
GRANT ALL ON TABLE public.profiles TO service_role;

-- RLS Policies
CREATE POLICY "Public read tutorial videos" ON public.tutorial_videos
  FOR SELECT USING (TRUE);

CREATE POLICY "Admin write tutorial videos" ON public.tutorial_videos
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()::text AND role = 'admin'));

-- RLS Policies
CREATE POLICY "Public read active coupons" ON public.coupons
  FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid()::text = id OR role = 'admin');

CREATE POLICY "Users can read own notifications" ON public.notifications
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid()::text = user_id);

-- ----------------------------------------------------------------------------
-- 7. AUTOMATED REFERRAL REWARD TRIGGER FUNCTION
-- Automatically applies trial day extensions or discount credits to referrer!
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_referral_reward()
RETURNS TRIGGER AS $$
BEGIN
  -- If referrer is on Free Plan, extend trial duration by 3 days
  -- If referrer is on a Paid Tier, grant 200 BDT reward credits
  IF NEW.reward_type = 'trial_extension_days' THEN
    UPDATE public.profiles
    SET trial_days_bonus = COALESCE(trial_days_bonus, 0) + NEW.reward_value,
        duration_days = duration_days + NEW.reward_value,
        expires_at = COALESCE(expires_at, NOW()) + (NEW.reward_value || ' days')::INTERVAL,
        updated_at = NOW()
    WHERE id = NEW.referrer_user_id;
  ELSIF NEW.reward_type = 'discount_credits' THEN
    UPDATE public.profiles
    SET reward_credits_bdt = COALESCE(reward_credits_bdt, 0) + NEW.reward_value,
        updated_at = NOW()
    WHERE id = NEW.referrer_user_id;
  END IF;

  -- Create in-app celebration notification for the referrer
  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    NEW.referrer_user_id,
    '🎁 Referral Bonus Credited!',
    'A fellow streamer joined using your invite code (' || NEW.invite_code || '). You received ' ||
      CASE WHEN NEW.reward_type = 'trial_extension_days'
           THEN '+' || NEW.reward_value || ' Bonus Days'
           ELSE '+' || NEW.reward_value || ' BDT Credits'
      END || '!',
    'referral_reward'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_referral_reward_applied ON public.user_referrals;
CREATE TRIGGER trg_referral_reward_applied
  AFTER INSERT ON public.user_referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_referral_reward();

-- ----------------------------------------------------------------------------
-- 8. MANUAL SUBSCRIPTION PAYMENT REQUESTS TABLE (bKash, Nagad & Rocket Approval Flow)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  plan_tier VARCHAR(20) NOT NULL CHECK (plan_tier IN ('basic', 'pro', 'business')),
  amount_bdt INT NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('bkash', 'nagad', 'rocket')),
  account_number VARCHAR(30) NOT NULL,
  sender_phone VARCHAR(30),
  trx_id VARCHAR(100) NOT NULL,
  screenshot_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  coupon_code VARCHAR(50),
  discount_bdt INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_user ON public.subscription_payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.subscription_payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_trx ON public.subscription_payment_requests(trx_id);

ALTER TABLE public.subscription_payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_requests_select_policy"
  ON public.subscription_payment_requests
  FOR SELECT USING (auth.uid() = user_id OR auth.role() = 'service_role' OR public.is_admin(auth.uid()));

CREATE POLICY "payment_requests_insert_policy"
  ON public.subscription_payment_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE POLICY "payment_requests_autonomous_update_policy"
  ON public.subscription_payment_requests
  FOR UPDATE USING (auth.role() = 'service_role' OR auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Autonomous System Settings & Vault Security Policy
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_settings_read_policy"
  ON public.system_settings
  FOR SELECT USING (true);

CREATE POLICY "system_settings_autonomous_manage_policy"
  ON public.system_settings
  FOR ALL USING (auth.role() = 'service_role' OR public.is_admin(auth.uid()));
