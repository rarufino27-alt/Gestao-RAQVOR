-- RAQVOR V2.10 — camada comercial, suporte, controle de acesso e auditoria
-- Execute depois das migrations de autenticação/RLS já aplicadas no projeto.
-- NÃO coloque service_role/secret key no navegador.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'support' check (role in ('owner','admin','support','analyst')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_access_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','blocked','suspended')),
  reason text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  category text not null default 'outro',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_user','resolved','closed')),
  sla_due_at timestamptz not null default (now() + interval '72 hours'),
  assigned_to uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  body text,
  message_type text not null default 'text' check (message_type in ('text','voice','system')),
  audio_path text,
  created_at timestamptz not null default now(),
  check (nullif(trim(coalesce(body,'')), '') is not null or audio_path is not null)
);

create table if not exists public.support_access_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null default 'support',
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_user on public.support_tickets(user_id, created_at desc);
create index if not exists idx_support_tickets_status on public.support_tickets(status, priority, sla_due_at);
create index if not exists idx_support_messages_ticket on public.support_messages(ticket_id, created_at);
create index if not exists idx_support_access_target on public.support_access_sessions(target_user_id, expires_at);

alter table public.admin_users enable row level security;
alter table public.user_access_controls enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_access_sessions enable row level security;
alter table public.admin_audit_log enable row level security;

-- Helper: true when caller is an active admin.
create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where a.user_id = auth.uid() and a.active = true
  );
$$;

-- Helper: true when an admin has an active temporary support session for a user.
create or replace function public.has_support_access(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.support_access_sessions s
    where s.admin_user_id = auth.uid()
      and s.target_user_id = target
      and s.revoked_at is null
      and now() between s.starts_at and s.expires_at
  );
$$;

-- Admin users: admins can see their own role; owner/admin can manage the table.
drop policy if exists admin_users_self on public.admin_users;
create policy admin_users_self on public.admin_users
for select to authenticated
using (user_id = auth.uid() or public.is_active_admin());

drop policy if exists admin_users_manage on public.admin_users;
create policy admin_users_manage on public.admin_users
for all to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

-- User access: users can see their own status; admins can manage.
drop policy if exists access_self on public.user_access_controls;
create policy access_self on public.user_access_controls
for select to authenticated
using (user_id = auth.uid() or public.is_active_admin());

drop policy if exists access_admin on public.user_access_controls;
create policy access_admin on public.user_access_controls
for all to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

-- Tickets: user sees own; admins see/manage all.
drop policy if exists support_ticket_user_select on public.support_tickets;
create policy support_ticket_user_select on public.support_tickets
for select to authenticated
using (user_id = auth.uid() or public.is_active_admin());

drop policy if exists support_ticket_user_insert on public.support_tickets;
create policy support_ticket_user_insert on public.support_tickets
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists support_ticket_admin_update on public.support_tickets;
create policy support_ticket_admin_update on public.support_tickets
for update to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

-- Messages: ticket owner or admins.
drop policy if exists support_message_select on public.support_messages;
create policy support_message_select on public.support_messages
for select to authenticated
using (
  public.is_active_admin()
  or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
);

drop policy if exists support_message_insert on public.support_messages;
create policy support_message_insert on public.support_messages
for insert to authenticated
with check (
  sender_user_id = auth.uid()
  and (
    public.is_active_admin()
    or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
  )
);

-- Temporary support access: only admins can manage.
drop policy if exists support_access_admin on public.support_access_sessions;
create policy support_access_admin on public.support_access_sessions
for all to authenticated
using (public.is_active_admin())
with check (public.is_active_admin() and admin_user_id = auth.uid());

-- Audit: admins can write/read their own administrative actions.
drop policy if exists audit_admin on public.admin_audit_log;
create policy audit_admin on public.admin_audit_log
for all to authenticated
using (public.is_active_admin())
with check (public.is_active_admin() and admin_user_id = auth.uid());

-- app_state: existing owner policy remains; add controlled support read access.
drop policy if exists app_state_admin_support_read on public.app_state;
create policy app_state_admin_support_read on public.app_state
for select to authenticated
using (
  exists (
    select 1
    from public.finance_workspaces w
    where w.id = workspace_id
      and public.has_support_access(w.owner_user_id)
  )
);

-- Realtime for support/access changes.
alter table public.support_tickets replica identity full;
alter table public.support_messages replica identity full;
alter table public.user_access_controls replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_tickets') then
    alter publication supabase_realtime add table public.support_tickets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_messages') then
    alter publication supabase_realtime add table public.support_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_access_controls') then
    alter publication supabase_realtime add table public.user_access_controls;
  end if;
end $$;

-- Storage bucket for support voice messages.
insert into storage.buckets (id, name, public)
values ('support-audio','support-audio',false)
on conflict (id) do nothing;

-- Users can upload/read their own audio under user-id/...
drop policy if exists support_audio_user_insert on storage.objects;
create policy support_audio_user_insert on storage.objects
for insert to authenticated
with check (bucket_id='support-audio' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists support_audio_user_read on storage.objects;
create policy support_audio_user_read on storage.objects
for select to authenticated
using (
  bucket_id='support-audio'
  and ((storage.foldername(name))[1]=auth.uid()::text or public.is_active_admin())
);

-- Bootstrap: after creating your first account, replace UUID below and run:
-- insert into public.admin_users(user_id, role) values ('SEU-UUID-AQUI','owner') on conflict (user_id) do update set role='owner', active=true;

-- Admin support visibility over customer directory (read-only).
drop policy if exists profiles_admin_support_read on public.profiles;
create policy profiles_admin_support_read on public.profiles
for select to authenticated
using (public.is_active_admin() or id = auth.uid());

drop policy if exists workspaces_admin_support_read on public.finance_workspaces;
create policy workspaces_admin_support_read on public.finance_workspaces
for select to authenticated
using (public.is_active_admin() or owner_user_id = auth.uid());

-- Commercial/customer profile: regional settings and subscription entitlement.
create table if not exists public.customer_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  country_code text not null default 'BR',
  language_code text not null default 'pt-BR',
  currency_code text not null default 'BRL',
  timezone text not null default 'America/Recife',
  plan_code text not null default 'trial',
  subscription_status text not null default 'trialing' check (subscription_status in ('trialing','active','past_due','paused','canceled')),
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_accounts enable row level security;
drop policy if exists customer_accounts_self on public.customer_accounts;
create policy customer_accounts_self on public.customer_accounts
for select to authenticated
using (user_id = auth.uid() or public.is_active_admin());
drop policy if exists customer_accounts_self_update on public.customer_accounts;
create policy customer_accounts_self_update on public.customer_accounts
for update to authenticated
using (user_id = auth.uid() or public.is_active_admin())
with check (user_id = auth.uid() or public.is_active_admin());
drop policy if exists customer_accounts_self_insert on public.customer_accounts;
create policy customer_accounts_self_insert on public.customer_accounts
for insert to authenticated
with check (user_id = auth.uid() or public.is_active_admin());

drop policy if exists support_audio_admin_insert on storage.objects;
create policy support_audio_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id='support-audio' and public.is_active_admin());

-- RAQVOR V2.11 — suporte profissional e modo de assistência completo
-- Admin com sessão de suporte pode consultar E alterar o app_state do cliente.
drop policy if exists app_state_admin_support_update on public.app_state;
create policy app_state_admin_support_update on public.app_state
for update to authenticated
using (
  exists (
    select 1 from public.finance_workspaces w
    where w.id = workspace_id
      and public.has_support_access(w.owner_user_id)
  )
)
with check (
  exists (
    select 1 from public.finance_workspaces w
    where w.id = workspace_id
      and public.has_support_access(w.owner_user_id)
  )
);

-- Mensagens de suporte por voz podem ser enviadas tanto pelo cliente quanto pelo suporte.
drop policy if exists support_audio_admin_insert on storage.objects;
create policy support_audio_admin_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='support-audio'
  and public.is_active_admin()
);

-- Admin precisa conseguir ler/baixar áudio de atendimento.
drop policy if exists support_audio_admin_read on storage.objects;
create policy support_audio_admin_read on storage.objects
for select to authenticated
using (
  bucket_id='support-audio'
  and public.is_active_admin()
);

-- Realtime para mensagens: conversa instantânea estilo mensageria.
alter table public.support_messages replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='support_messages'
  ) then
    alter publication supabase_realtime add table public.support_messages;
  end if;
end $$;
