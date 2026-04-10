create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  mime_type text not null,
  size bigint not null check (size > 0),
  checksum text not null,
  storage_key text not null,
  status text not null check (status in ('uploaded', 'ready', 'too_large', 'unsupported', 'error')),
  kind text not null check (kind in ('pdf', 'docx', 'xlsx', 'csv', 'txt', 'md')),
  page_count integer,
  text_extraction_status text check (text_extraction_status in ('ready', 'too_large', 'unsupported', 'error')),
  extracted_text text,
  text_length integer,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, checksum)
);

create trigger touch_documents_updated_at
before update on public.documents
for each row execute function public.touch_updated_at();

create index idx_documents_user_created_at on public.documents (user_id, created_at desc);

alter table public.documents enable row level security;

create policy "documents_own"
on public.documents for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
