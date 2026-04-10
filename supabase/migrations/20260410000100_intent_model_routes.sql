create table if not exists public.intent_model_routes (
  plan_code text not null references public.plan_definitions (code) on delete cascade,
  channel text not null check (channel in ('text', 'voice')),
  intent_route text not null check (
    intent_route in (
      'conversation',
      'planner_read',
      'planner_mutation',
      'external_lookup',
      'hybrid'
    )
  ),
  primary_provider text not null,
  primary_model text not null,
  fallback_provider text,
  fallback_model text,
  model_tier text not null check (model_tier in ('fast', 'heavy')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (plan_code, channel, intent_route)
);

alter table public.intent_model_routes enable row level security;

drop policy if exists "intent_model_routes_read_authenticated" on public.intent_model_routes;

create policy "intent_model_routes_read_authenticated"
on public.intent_model_routes for select
to authenticated
using (true);

insert into public.intent_model_routes (
  plan_code,
  channel,
  intent_route,
  primary_provider,
  primary_model,
  fallback_provider,
  fallback_model,
  model_tier,
  enabled
)
values
  ('free', 'text', 'conversation', 'openrouter', 'google/gemma-3-12b-it:free', 'google', 'gemini-3.1-flash-lite-preview', 'fast', true),
  ('free', 'text', 'planner_read', 'openrouter', 'google/gemma-3-12b-it:free', 'google', 'gemini-3.1-flash-lite-preview', 'fast', true),
  ('free', 'text', 'planner_mutation', 'google', 'gemini-3.1-flash-lite-preview', 'openrouter', 'google/gemma-3-12b-it:free', 'heavy', true),
  ('free', 'text', 'external_lookup', 'google', 'gemini-3.1-flash-lite-preview', 'openrouter', 'google/gemma-3-12b-it:free', 'heavy', true),
  ('free', 'text', 'hybrid', 'google', 'gemini-3.1-flash-lite-preview', 'openrouter', 'google/gemma-3-12b-it:free', 'heavy', true),
  ('premium', 'text', 'conversation', 'openrouter', 'google/gemma-3-12b-it:free', 'google', 'gemini-3.1-flash-lite-preview', 'fast', true),
  ('premium', 'text', 'planner_read', 'openrouter', 'google/gemma-3-12b-it:free', 'google', 'gemini-3.1-flash-lite-preview', 'fast', true),
  ('premium', 'text', 'planner_mutation', 'google', 'gemini-3.1-flash-lite-preview', 'openrouter', 'google/gemma-3-12b-it:free', 'heavy', true),
  ('premium', 'text', 'external_lookup', 'google', 'gemini-3.1-flash-lite-preview', 'openrouter', 'google/gemma-3-12b-it:free', 'heavy', true),
  ('premium', 'text', 'hybrid', 'google', 'gemini-3.1-flash-lite-preview', 'openrouter', 'google/gemma-3-12b-it:free', 'heavy', true)
on conflict (plan_code, channel, intent_route) do update
set
  primary_provider = excluded.primary_provider,
  primary_model = excluded.primary_model,
  fallback_provider = excluded.fallback_provider,
  fallback_model = excluded.fallback_model,
  model_tier = excluded.model_tier,
  enabled = excluded.enabled;
