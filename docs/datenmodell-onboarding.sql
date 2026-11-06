-- WEMEDIA Cockpit · Onboarding & Social CI
-- Entwurf fürs spätere Supabase-Backend (Repo wemedia-social-cockpit).
-- Im Prototyp liegen dieselben Felder im Browser-Speicher unter
--   S.brands[clientId].ob   (Onboarding)   und   S.brands[clientId].sci   (Social CI).
-- Nicht ausführen, bevor Camillo das Go gibt.

-- 1) Onboarding pro Kunde: ein Datensatz, Schritte als Status-Map
create table if not exists onboardings (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  current_step  smallint not null default 0,          -- 0..7
  step_status   jsonb not null default '{}',          -- { "uebergabe":"done", "zugaenge":"skip", ... }
  kickoff_way   text check (kickoff_way in ('form','call')),
  kickoff_at    timestamptz,
  kickoff_notes text,
  started_by    uuid references profiles(id),
  started_at    timestamptz not null default now(),
  closed_at     timestamptz,                          -- Agent hat Social CI erstellt
  done_at       timestamptz,                          -- Social CI freigegeben + alle Zugänge da
  unique (client_id)
);

-- 2) Zugänge (Meta, Pixel, TikTok, LinkedIn, YouTube, Google)
create table if not exists client_access (
  client_id   uuid not null references clients(id) on delete cascade,
  kind        text not null check (kind in ('meta','pixel','tiktok','linkedin','youtube','google')),
  status      text not null default 'open' check (status in ('open','req','ok','na')),
  requested_at timestamptz,
  received_at  timestamptz,
  primary key (client_id, kind)
);

-- 3) Markenprofil-Erweiterungen aus dem Wizard
alter table brand_profiles
  add column if not exists offers        text,
  add column if not exists competitors   text,
  add column if not exists tones         text[] default '{}',
  add column if not exists address_form  text check (address_form in ('Du','Sie')),
  add column if not exists ci_manual     text check (ci_manual in ('ja','nein','arbeit')),
  add column if not exists font_head     text,
  add column if not exists font_body     text,
  add column if not exists material      text check (material in ('viel','etwas','kaum')),
  add column if not exists material_link text,
  add column if not exists content_sources text[] default '{}',   -- kunde, dreh, ki, stock
  add column if not exists ai_images     text check (ai_images in ('ja','teil','nein')),
  add column if not exists people_ok     text check (people_ok in ('ja','klaeren','nein')),
  add column if not exists content_note  text,
  add column if not exists goal_kpi      text,
  add column if not exists posting_days  text[] default '{}',
  add column if not exists season_dates  text,
  add column if not exists approver_name  text,
  add column if not exists approver_email text,
  add column if not exists approval_speed text;

-- 4) Social CI – versioniert, nur eine freigegebene Version ist aktiv
create table if not exists social_ci (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  version     int  not null,
  status      text not null default 'entwurf' check (status in ('entwurf','freigegeben','ersetzt')),
  colors      jsonb not null,   -- [{hex, role, use}]
  fonts       jsonb not null,   -- {head, body}
  formats     jsonb not null,   -- [[name, size, ratio]]
  layout      text[] not null,
  imagery     text[] not null,
  voice       text[] not null,
  pillars     jsonb not null,   -- [{t, s}]
  sources     text[] not null default '{}',
  figma_file  text,             -- wird gesetzt, sobald Grafik das Board angelegt hat
  created_by  text not null default 'Social-CI-Agent',
  created_at  timestamptz not null default now(),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  unique (client_id, version)
);

-- 5) Agentur-Einstellungen (IDs für Zugangs-Anleitungen)
create table if not exists agency_settings (
  id          boolean primary key default true check (id),   -- genau eine Zeile
  meta_business_id   text,
  tiktok_bc_id       text,
  google_ads_mcc     text,
  invite_email       text default 'social@wemedia.at'
);

-- Events für den Event-Bus (Migration 200):
--   onboarding.step_done, onboarding.access_received,
--   social_ci.created, social_ci.approved  → Aufgabe „Figma-Board anlegen“ (Grafik)
--                                          + „Ersten Redaktionsplan erstellen“ (SMM)
--   onboarding.done
