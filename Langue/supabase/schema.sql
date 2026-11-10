-- Langue : tables + sécurité (chaque utilisateur ne voit que ses propres données).
-- À coller dans Supabase > SQL Editor > New query > Run.

create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  en text not null,
  fr text not null,
  pos text default '',
  example text default '',
  example_fr text default '',
  alternatives text[] default '{}',
  day_key date not null,
  created_at timestamptz not null default now()
);
create index if not exists words_user_idx on public.words (user_id, created_at desc);

create table if not exists public.daily (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day_key date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day_key)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null,            -- text | questions | review | library
  day_key date not null,
  errors int,
  score numeric,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_user_idx on public.events (user_id, created_at);

create table if not exists public.push_subscriptions (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  subscription jsonb,
  enabled boolean not null default false,
  remind_hour int not null default 20,
  timezone text not null default 'Europe/Paris',
  last_sent_day date,
  updated_at timestamptz not null default now()
);

alter table public.words enable row level security;
alter table public.daily enable row level security;
alter table public.events enable row level security;
alter table public.push_subscriptions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['words','daily','events','push_subscriptions'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;
