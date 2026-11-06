-- WEMEDIA Cockpit · Backend v1
-- Eigenes Supabase-Projekt nur für die Agentur-Automatisierung (getrennt vom Finanz-Cockpit).
-- Rollen: admin (Geschäftsführung), sales (Setter/Closer), smm (Social Media), grafik, kunde.
-- Grundsatz: Betreuungskosten sehen nur admin + sales; Kunden sehen nur ihren eigenen Bereich.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Rollen, Einladungen, Profile
-- ---------------------------------------------------------------------------
create type app_role as enum ('admin', 'sales', 'smm', 'grafik', 'kunde');

create table clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  handle          text,
  branche         text,
  platforms       text[] not null default '{IG,FB}',
  posts_per_month int not null default 8,
  contact         text,
  firma           jsonb,                 -- Firmendaten aus dem CRM (ohne Preise)
  goal            text,
  package_id      text,                  -- performance | growth | ultimate
  modules         jsonb not null default '[]',
  from_deal       jsonb,                 -- Deal-Herkunft OHNE Preise (Titel, Quelle, Closer, Datum, Call-Notiz)
  created_at      timestamptz not null default now()
);

create table invites (
  email      text primary key,
  name       text not null,
  role       app_role not null,
  client_id  uuid references clients(id) on delete cascade,
  invited_by uuid,
  created_at timestamptz not null default now()
);

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  name       text not null,
  initials   text,
  role       app_role not null,
  client_id  uuid references clients(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Neuer Login → Profil aus Einladung. Ohne Einladung kein Profil = kein Zugriff.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  select * into inv from invites where lower(email) = lower(new.email);
  if inv.email is null then return new; end if;
  insert into profiles (id, email, name, initials, role, client_id)
  values (new.id, new.email, inv.name,
          upper(left(split_part(inv.name, ' ', 1), 1) || coalesce(left(split_part(inv.name, ' ', 2), 1), '')),
          inv.role, inv.client_id)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Hilfsfunktionen für RLS
create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;
create or replace function my_client() returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from profiles where id = auth.uid()
$$;
create or replace function is_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()) = any(roles), false)
$$;

-- Modulrechte pro Rolle (editierbar unter „Team & Rollen“)
create table role_access (
  role    app_role primary key,
  modules text[] not null
);
insert into role_access values
  ('admin',  '{home,freigaben,crm,social,grafik,performance,portal,team}'),
  ('sales',  '{home,crm}'),
  ('smm',    '{home,social,grafik,performance,portal}'),
  ('grafik', '{home,grafik}'),
  ('kunde',  '{portal}');

-- ---------------------------------------------------------------------------
-- Vertrag & Preise – NUR admin + sales
-- ---------------------------------------------------------------------------
create table client_contracts (
  client_id    uuid primary key references clients(id) on delete cascade,
  package_id   text,
  monthly_fee  numeric,
  setup_fee    numeric,
  total_6m     numeric,
  offer        jsonb,          -- Angebot aus dem CRM (Nummer, Module, sevDesk-ID …)
  signed_at    date,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Markenprofil, Onboarding, Social CI, Dateien
-- ---------------------------------------------------------------------------
create table brand_profiles (
  client_id   uuid primary key references clients(id) on delete cascade,
  pos         text,
  tone        text,
  aud         text,
  dos         text[] not null default '{}',
  donts       text[] not null default '{}',
  colors      text[] not null default '{}',
  tags        text,
  ad_budget   numeric,                 -- Ad-Spend: darf die SMM sehen
  proposal    jsonb,                   -- Vorschlag des Sales-Agents (ohne Preise)
  learned     jsonb not null default '[]',
  checklist   jsonb not null default '{}',   -- alte Onboarding-Checkliste (vertrag, brand, meta, google, login, plan)
  shoots      jsonb not null default '[]',
  onb_form    jsonb,                   -- Fragebogen-Status (gesendet, ausgefüllt …)
  wizard      jsonb not null default '{"step":0,"st":{},"d":{}}',  -- Schritt-für-Schritt-Onboarding
  figma       jsonb,                   -- {url, at, by}
  updated_at  timestamptz not null default now()
);

create table social_ci (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  version     int not null,
  status      text not null default 'entwurf' check (status in ('entwurf','freigegeben','ersetzt')),
  data        jsonb not null,          -- colors, fonts, formats, layout, imagery, voice, pillars, sources, goal
  created_by  text not null default 'Social-CI-Agent',
  created_at  timestamptz not null default now(),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  unique (client_id, version)
);

create table brand_files (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  kind         text not null check (kind in ('logo-vec','logo-png','cicd','fonts','assets')),
  name         text not null,
  mime         text,
  size         bigint,
  storage_path text not null,          -- Bucket „brand-files“: <client_id>/<uuid>-<name>
  uploaded_by  text,
  created_at   timestamptz not null default now()
);

-- Öffentlicher Kunden-Fragebogen: Zugang nur über ein zufälliges Token, nie über die Kunden-ID
create table onboarding_tokens (
  token      text primary key default encode(gen_random_bytes(18), 'base64url'),
  client_id  uuid not null references clients(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 days',
  used_at    timestamptz
);

-- ---------------------------------------------------------------------------
-- Redaktionsplan, Kampagnen, Agent-Vorschläge, Aufgaben, Events
-- ---------------------------------------------------------------------------
create table posts (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  title      text not null,
  type       text not null default 'Feed',
  date       date not null,
  platforms  text,
  status     text not null default 'konzept'
             check (status in ('konzept','briefing','produktion','intern','freigabe','aenderung','freigegeben','geplant','live')),
  caption    text,
  hashtags   text,
  visual     int,
  briefing   text,
  source     text,                     -- kunde | dreh | ki | stock
  figma_node text,
  asset_url  text,
  comments   jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaigns (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  name       text not null,
  goal       text,
  platform   text,
  start_date date,
  end_date   date,
  budget     numeric not null default 0,  -- Mediabudget (Ad-Spend), kein Honorar
  spend      numeric not null default 0,
  results    numeric,
  audience   text,
  creatives  text[] not null default '{}',
  status     text not null default 'entwurf'
             check (status in ('entwurf','freigabe','aenderung','freigegeben','aktiv','beendet')),
  approval   jsonb,
  change     jsonb,
  comments   jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table suggestions (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id) on delete cascade,
  key        text unique,
  kind       text not null,             -- briefing | caption | time | budget | concept
  agent      text not null,
  ref        uuid,
  title      text,
  text       text,
  value      jsonb,
  why        text,
  status     text not null default 'open' check (status in ('open','accepted','edited','rejected')),
  decided    jsonb,
  created_at timestamptz not null default now()
);

create table tasks (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,             -- offer | onbform | figma | plan | …
  client_id  uuid references clients(id) on delete cascade,
  deal_ref   text,
  title      text not null,
  sub        text,
  for_role   app_role not null,
  go         text,
  done       boolean not null default false,
  done_at    timestamptz,
  done_text  text,
  created_at timestamptz not null default now()
);

create table events (
  id         bigint generated always as identity primary key,
  type       text not null,             -- deal.won, onboarding.step_done, social_ci.approved, figma.board_created …
  client_id  uuid references clients(id) on delete cascade,
  payload    jsonb not null default '{}',
  actor      uuid,
  created_at timestamptz not null default now()
);

create table agency_settings (
  id           boolean primary key default true check (id),
  meta_id      text,
  tiktok_id    text,
  google_mcc   text,
  invite_email text default 'social@wemedia.at'
);
insert into agency_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table clients           enable row level security;
alter table invites           enable row level security;
alter table profiles          enable row level security;
alter table role_access       enable row level security;
alter table client_contracts  enable row level security;
alter table brand_profiles    enable row level security;
alter table social_ci         enable row level security;
alter table brand_files       enable row level security;
alter table onboarding_tokens enable row level security;
alter table posts             enable row level security;
alter table campaigns         enable row level security;
alter table suggestions       enable row level security;
alter table tasks             enable row level security;
alter table events            enable row level security;
alter table agency_settings   enable row level security;

-- Team = alle internen Rollen
create or replace function is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select is_role('admin','sales','smm','grafik')
$$;

-- clients: Team liest, admin/sales/smm schreiben, Kunde liest nur sich selbst
create policy clients_team_read  on clients for select using (is_team());
create policy clients_kunde_read on clients for select using (is_role('kunde') and id = my_client());
create policy clients_write      on clients for all using (is_role('admin','sales','smm')) with check (is_role('admin','sales','smm'));

-- Verträge & Preise: ausschließlich admin + sales
create policy contracts_rw on client_contracts for all using (is_role('admin','sales')) with check (is_role('admin','sales'));

-- Profile: jede:r sieht sich selbst; Team sieht Team; admin verwaltet
create policy profiles_self  on profiles for select using (id = auth.uid());
create policy profiles_team  on profiles for select using (is_team());
create policy profiles_admin on profiles for all using (is_role('admin')) with check (is_role('admin'));
create policy invites_admin  on invites for all using (is_role('admin','smm')) with check (is_role('admin') or (is_role('smm') and role = 'kunde'));
create policy access_read    on role_access for select using (auth.uid() is not null);
create policy access_admin   on role_access for all using (is_role('admin')) with check (is_role('admin'));

-- Markenprofil, Social CI, Dateien: Team liest; admin/smm schreiben; Grafik darf Figma-Link setzen; Kunde liest eigenes Profil
create policy brand_team_read  on brand_profiles for select using (is_team());
create policy brand_kunde_read on brand_profiles for select using (is_role('kunde') and client_id = my_client());
create policy brand_write      on brand_profiles for all using (is_role('admin','smm','sales')) with check (is_role('admin','smm','sales'));
create policy brand_grafik_upd on brand_profiles for update using (is_role('grafik')) with check (is_role('grafik'));

create policy sci_team_read on social_ci for select using (is_team());
create policy sci_write     on social_ci for all using (is_role('admin','smm')) with check (is_role('admin','smm'));

create policy files_team_read  on brand_files for select using (is_team());
create policy files_kunde_read on brand_files for select using (is_role('kunde') and client_id = my_client());
create policy files_write      on brand_files for all using (is_role('admin','smm','grafik')) with check (is_role('admin','smm','grafik'));

create policy tokens_team on onboarding_tokens for all using (is_role('admin','smm')) with check (is_role('admin','smm'));

-- Beiträge & Kampagnen: Team liest; smm/admin/grafik schreiben; Kunde liest eigene (Freigaben laufen über Funktionen)
create policy posts_team_read  on posts for select using (is_team());
create policy posts_kunde_read on posts for select using (is_role('kunde') and client_id = my_client()
                                  and status in ('freigabe','aenderung','freigegeben','geplant','live'));
create policy posts_write      on posts for all using (is_role('admin','smm','grafik')) with check (is_role('admin','smm','grafik'));

create policy camps_team_read  on campaigns for select using (is_team());
create policy camps_kunde_read on campaigns for select using (is_role('kunde') and client_id = my_client() and status <> 'entwurf');
create policy camps_write      on campaigns for all using (is_role('admin','smm')) with check (is_role('admin','smm'));

create policy sugg_rw on suggestions for all using (is_role('admin','smm')) with check (is_role('admin','smm'));

-- Aufgaben: man sieht die eigenen Rollen-Aufgaben, admin alle
create policy tasks_read  on tasks for select using (is_role('admin') or for_role = my_role());
create policy tasks_write on tasks for all using (is_team()) with check (is_team());

create policy events_read  on events for select using (is_role('admin'));
create policy events_write on events for insert with check (auth.uid() is not null);

create policy settings_read  on agency_settings for select using (is_team());
create policy settings_write on agency_settings for update using (is_role('admin','smm')) with check (is_role('admin','smm'));

-- ---------------------------------------------------------------------------
-- Kunden-Aktionen über Funktionen (nur genau das, was der Kunde darf)
-- ---------------------------------------------------------------------------
create or replace function kunde_post_decision(p_post uuid, p_ok boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if not is_role('kunde') then raise exception 'nur für Kunden'; end if;
  select name into who from profiles where id = auth.uid();
  update posts set
    status   = case when p_ok then 'freigegeben' else 'aenderung' end,
    comments = comments || jsonb_build_array(jsonb_build_object('who','Kunde','name',who,'text',coalesce(p_comment, case when p_ok then 'Freigegeben' else 'Bitte ändern' end),'at',now())),
    updated_at = now()
  where id = p_post and client_id = my_client() and status in ('freigabe','aenderung');
  insert into events (type, client_id, payload, actor)
  values (case when p_ok then 'post.approved' else 'post.change_requested' end, my_client(), jsonb_build_object('post', p_post), auth.uid());
end $$;

create or replace function kunde_campaign_decision(p_camp uuid, p_ok boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare who text; amt numeric;
begin
  if not is_role('kunde') then raise exception 'nur für Kunden'; end if;
  select name into who from profiles where id = auth.uid();
  select budget into amt from campaigns where id = p_camp and client_id = my_client();
  update campaigns set
    status   = case when p_ok then 'freigegeben' else 'aenderung' end,
    approval = case when p_ok then jsonb_build_object('by',who,'at',now(),'amount',amt) else approval end,
    comments = comments || jsonb_build_array(jsonb_build_object('who','Kunde','name',who,'text',coalesce(p_comment,''),'at',now()))
  where id = p_camp and client_id = my_client() and status in ('freigabe','aenderung');
  insert into events (type, client_id, payload, actor)
  values (case when p_ok then 'campaign.approved' else 'campaign.change_requested' end, my_client(), jsonb_build_object('campaign', p_camp, 'amount', amt), auth.uid());
end $$;

-- Öffentlicher Fragebogen (ohne Login): lesen + absenden nur mit gültigem Token
create or replace function onboarding_form_get(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('client', c.name, 'done', t.used_at is not null,
         'prefill', jsonb_build_object('pos', b.pos, 'aud', b.aud, 'colors', b.colors, 'tags', b.tags, 'goal', c.goal, 'contact', c.contact))
  from onboarding_tokens t join clients c on c.id = t.client_id left join brand_profiles b on b.client_id = c.id
  where t.token = p_token and t.expires_at > now()
$$;

create or replace function onboarding_form_submit(p_token text, p_answers jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select client_id into cid from onboarding_tokens where token = p_token and expires_at > now() and used_at is null;
  if cid is null then return false; end if;
  update brand_profiles set
    pos   = coalesce(nullif(p_answers->>'pos',''), pos),
    aud   = coalesce(nullif(p_answers->>'aud',''), aud),
    tone  = coalesce(nullif(p_answers->>'tone',''), tone),
    dos   = case when jsonb_array_length(coalesce(p_answers->'dos','[]')) > 0 then array(select jsonb_array_elements_text(p_answers->'dos')) else dos end,
    donts = case when jsonb_array_length(coalesce(p_answers->'donts','[]')) > 0 then array(select jsonb_array_elements_text(p_answers->'donts')) else donts end,
    colors= case when jsonb_array_length(coalesce(p_answers->'colors','[]')) > 0 then array(select jsonb_array_elements_text(p_answers->'colors')) else colors end,
    tags  = coalesce(nullif(p_answers->>'tags',''), tags),
    proposal = null,
    onb_form = coalesce(onb_form,'{}') || jsonb_build_object('doneAt', now(), 'answers', p_answers),
    wizard = jsonb_set(wizard, '{d,form}', p_answers, true),
    updated_at = now()
  where client_id = cid;
  update clients set goal = coalesce(nullif(p_answers->>'goal',''), goal) where id = cid;
  update onboarding_tokens set used_at = now() where token = p_token;
  insert into tasks (kind, client_id, title, sub, for_role, go)
  select 'onbform', cid, name || ' hat das Onboarding-Formular ausgefüllt', 'Social · Markenprofil prüfen', 'smm', 'onb:' || cid from clients where id = cid;
  insert into events (type, client_id, payload) values ('onboarding.form_submitted', cid, '{}');
  return true;
end $$;
grant execute on function onboarding_form_get(text), onboarding_form_submit(text, jsonb) to anon;

-- ---------------------------------------------------------------------------
-- Speicher für Logos & CI-Dateien (privat; Zugriff über signierte URLs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('brand-files', 'brand-files', false)
  on conflict (id) do nothing;
create policy brandfiles_team_read on storage.objects for select
  using (bucket_id = 'brand-files' and is_team());
create policy brandfiles_kunde_read on storage.objects for select
  using (bucket_id = 'brand-files' and is_role('kunde') and (storage.foldername(name))[1] = my_client()::text);
create policy brandfiles_write on storage.objects for insert
  with check (bucket_id = 'brand-files' and is_role('admin','smm','grafik'));
create policy brandfiles_delete on storage.objects for delete
  using (bucket_id = 'brand-files' and is_role('admin','smm','grafik'));

-- Realtime für Live-Aktualisierung zwischen Tabs und Personen
alter publication supabase_realtime add table clients, brand_profiles, social_ci, posts, campaigns, suggestions, tasks;
