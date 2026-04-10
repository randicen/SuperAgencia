alter table public.chat_messages
  add column if not exists metadata jsonb;

alter table public.plan_definitions
  add column if not exists web_search_enabled boolean not null default true;

update public.plan_definitions
set web_search_enabled = true
where web_search_enabled is distinct from true;

alter table public.usage_events
  drop constraint if exists usage_events_channel_check;

alter table public.usage_events
  add constraint usage_events_channel_check
  check (channel in ('text', 'voice', 'web_search'));
