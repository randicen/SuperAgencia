-- Google Calendar Sensor: Server-side tables
-- user_gcal_settings: Stores the user's secret iCal URL (never exposed to frontend)
-- gcal_cache: Server-side cache of parsed events (TTL-based invalidation)

CREATE TABLE IF NOT EXISTS user_gcal_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    ical_url TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gcal_cache (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    events_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: Users can only read/write their own rows
ALTER TABLE user_gcal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gcal_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own gcal settings"
    ON user_gcal_settings FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own gcal cache"
    ON gcal_cache FOR SELECT
    USING (auth.uid() = user_id);

-- Edge Function needs service_role to write cache, so no INSERT/UPDATE policy for gcal_cache
-- The Edge Function uses the service_role key, bypassing RLS for writes
