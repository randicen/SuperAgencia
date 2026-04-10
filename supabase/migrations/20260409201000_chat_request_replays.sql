create table if not exists public.chat_request_replays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id text not null,
  status text not null check (status in ('pending', 'completed')),
  response_state jsonb,
  response_reply text,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists idx_chat_request_replays_user_created_at
  on public.chat_request_replays (user_id, created_at desc);

alter table public.chat_request_replays enable row level security;

drop policy if exists "chat_request_replays_own" on public.chat_request_replays;
create policy "chat_request_replays_own"
on public.chat_request_replays for select
to authenticated
using (user_id = auth.uid());
