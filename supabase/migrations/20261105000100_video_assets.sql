CREATE TABLE IF NOT EXISTS public.video_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    original_key TEXT NOT NULL,
    ready_key TEXT,
    orientation TEXT CHECK (orientation IN ('vertical', 'landscape')),
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'ready', 'failed')),
    error_message TEXT,
    width INTEGER,
    height INTEGER,
    bitrate BIGINT,
    duration_seconds NUMERIC(12, 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_video_assets_user_id
    ON public.video_assets(user_id);

ALTER TABLE public.streams
    ADD COLUMN IF NOT EXISTS video_asset_id UUID
    REFERENCES public.video_assets(id);

NOTIFY pgrst, 'reload schema';
