-- WEMEDIA Cockpit · Backend v1.1 – Dokument-Tabellen
-- Jede Tabelle hat die Schlüsselspalten, die für Rechte gebraucht werden (id, client_id, status, Rolle),
-- und den vollständigen Datensatz des Cockpits in `data`. IDs sind bigint wie im Cockpit.
-- Preise/Honorare liegen getrennt in client_contracts (nur admin + sales).

-- alte Struktur (leer) entfernen
drop table if exists events, tasks, suggestions, campaigns, posts, onboarding_tokens, brand_files, social_ci,
  brand_profiles, client_contracts, role_access, profiles, invites, clients, agency_settings cascade;
drop function if exists handle_new_user() cascade;
drop function if exists my_role() cascade;
drop function if exists my_client() cascade;
drop function if exists is_role(variadic app_role[]) cascade;
drop function if exists is_team() cascade;
drop function if exists kunde_post_decision(uuid, boolean, text) cascade;
drop function if exists kunde_campaign_decision(uuid, boolean, text) cascade;
drop function if exists onboarding_form_get(text) cascade;
drop function if exists onboarding_form_submit(text, jsonb) cascade;
drop policy if exists brandfiles_team_read on storage.objects;
drop policy if exists brandfiles_kunde_read on storage.objects;
drop policy if exists brandfiles_write on storage.objects;
drop policy if exists brandfiles_delete on storage.objects;

-- ---------------------------------------------------------------------------
create table clients (
  id         bigint primary key,
  name       text not null,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table client_contracts (
  client_id  bigint primary key references clients(id) on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table brands (
  client_id  bigint primary key references clients(id) on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table posts (
  id         bigint primary key,
  client_id  bigint not null references clients(id) on delete cascade,
  status     text not null,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table campaigns (
  id         bigint primary key,
  client_id  bigint not null references clients(id) on delete cascade,
  status     text not null,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table suggestions (
  id         bigint primary key,
  client_id  bigint references clients(id) on delete cascade,
  status     text,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table tasks (
  id         bigint primary key,
  client_id  bigint references clients(id) on delete cascade,
  for_role   app_role not null,
  done       boolean not null default false,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table invites (
  email      text primary key,
  name       text not null,
  initials   text,
  role       app_role not null,
  client_id  bigint references clients(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  name       text not null,
  initials   text,
  role       app_role not null,
  client_id  bigint references clients(id) on delete set null,
  created_at timestamptz not null default now()
);
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
create table settings (
  key  text primary key,
  data jsonb not null default '{}'
);
insert into settings values ('agency', '{"metaId":"","tiktokId":"","mcc":"","email":"social@wemedia.at"}');
create table onboarding_tokens (
  token      text primary key default encode(gen_random_bytes(18), 'hex'),
  client_id  bigint not null references clients(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '45 days',
  used_at    timestamptz
);
create table events (
  id         bigint generated always as identity primary key,
  type       text not null,
  client_id  bigint references clients(id) on delete cascade,
  payload    jsonb not null default '{}',
  actor      uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rollen-Helfer
create function my_role() returns app_role language sql stable security definer set search_path = public as
  $$ select role from profiles where id = auth.uid() $$;
create function my_client() returns bigint language sql stable security definer set search_path = public as
  $$ select client_id from profiles where id = auth.uid() $$;
create function is_role(variadic roles app_role[]) returns boolean language sql stable security definer set search_path = public as
  $$ select coalesce((select role from profiles where id = auth.uid()) = any(roles), false) $$;
create function is_team() returns boolean language sql stable security definer set search_path = public as
  $$ select is_role('admin','sales','smm','grafik') $$;

-- Login → Profil aus Einladung
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  select * into inv from invites where lower(email) = lower(new.email);
  if inv.email is null then return new; end if;
  insert into profiles (id, email, name, initials, role, client_id)
  values (new.id, lower(new.email), inv.name,
          coalesce(inv.initials, upper(left(split_part(inv.name,' ',1),1) || coalesce(left(split_part(inv.name,' ',2),1),''))),
          inv.role, inv.client_id)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
alter table clients enable row level security;
alter table client_contracts enable row level security;
alter table brands enable row level security;
alter table posts enable row level security;
alter table campaigns enable row level security;
alter table suggestions enable row level security;
alter table tasks enable row level security;
alter table invites enable row level security;
alter table profiles enable row level security;
alter table role_access enable row level security;
alter table settings enable row level security;
alter table onboarding_tokens enable row level security;
alter table events enable row level security;

-- Team arbeitet gemeinsam an Kunden, Marken, Beiträgen, Kampagnen, Vorschlägen
create policy t_sel on clients for select using (is_team() or (is_role('kunde') and id = my_client()));
create policy t_ins on clients for insert with check (is_team());
create policy t_upd on clients for update using (is_team()) with check (is_team());
create policy t_del on clients for delete using (is_role('admin','smm'));

create policy c_all on client_contracts for all using (is_role('admin','sales')) with check (is_role('admin','sales'));

create policy b_sel on brands for select using (is_team() or (is_role('kunde') and client_id = my_client()));
create policy b_ins on brands for insert with check (is_team());
create policy b_upd on brands for update using (is_team()) with check (is_team());
create policy b_del on brands for delete using (is_role('admin','smm'));

create policy p_sel on posts for select using (is_team() or (is_role('kunde') and client_id = my_client()
  and status in ('freigabe','aenderung','freigegeben','geplant','live')));
create policy p_ins on posts for insert with check (is_team());
create policy p_upd on posts for update using (is_team()) with check (is_team());
create policy p_del on posts for delete using (is_role('admin','smm'));

create policy k_sel on campaigns for select using (is_team() or (is_role('kunde') and client_id = my_client() and status <> 'entwurf'));
create policy k_ins on campaigns for insert with check (is_team());
create policy k_upd on campaigns for update using (is_team()) with check (is_team());
create policy k_del on campaigns for delete using (is_role('admin','smm'));

create policy s_all on suggestions for all using (is_team()) with check (is_team());

create policy a_sel on tasks for select using (is_role('admin') or for_role = my_role());
create policy a_ins on tasks for insert with check (is_team());
create policy a_upd on tasks for update using (is_role('admin') or for_role = my_role()) with check (is_team());
create policy a_del on tasks for delete using (is_role('admin','smm'));

create policy i_all on invites for all using (is_role('admin') or (is_role('smm','sales') and role = 'kunde'))
  with check (is_role('admin') or (is_role('smm','sales') and role = 'kunde'));
create policy pr_sel on profiles for select using (id = auth.uid() or is_team());
create policy pr_adm on profiles for all using (is_role('admin')) with check (is_role('admin'));
create policy ra_sel on role_access for select using (auth.uid() is not null);
create policy ra_adm on role_access for all using (is_role('admin')) with check (is_role('admin'));
create policy st_sel on settings for select using (is_team());
create policy st_upd on settings for update using (is_role('admin','smm')) with check (is_role('admin','smm'));
create policy ot_all on onboarding_tokens for all using (is_team()) with check (is_team());
create policy ev_sel on events for select using (is_role('admin'));
create policy ev_ins on events for insert with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Kunden-Aktionen (nur Status/Kommentare/Freigabe – nichts anderes)
create function kunde_update_post(p_id bigint, p_status text, p_comments jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_role('kunde') then raise exception 'nur für Kunden'; end if;
  if p_status not in ('freigabe','aenderung','freigegeben') then raise exception 'Status nicht erlaubt'; end if;
  update posts set status = p_status,
         data = data || jsonb_build_object('status', p_status, 'comments', coalesce(p_comments, data->'comments')),
         updated_at = now()
   where id = p_id and client_id = my_client() and status in ('freigabe','aenderung','freigegeben');
  insert into events (type, client_id, payload) values ('post.' || p_status, my_client(), jsonb_build_object('post', p_id));
end $$;

create function kunde_update_campaign(p_id bigint, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cur jsonb; st text; allowed jsonb := '{}';
begin
  if not is_role('kunde') then raise exception 'nur für Kunden'; end if;
  select data into cur from campaigns where id = p_id and client_id = my_client() and status <> 'entwurf';
  if cur is null then raise exception 'Kampagne nicht gefunden'; end if;
  st := coalesce(p_patch->>'status', cur->>'status');
  if st not in ('freigabe','aenderung','freigegeben','aktiv','beendet') then raise exception 'Status nicht erlaubt'; end if;
  if p_patch ? 'status'   then allowed := allowed || jsonb_build_object('status', st); end if;
  if p_patch ? 'approval' then allowed := allowed || jsonb_build_object('approval', p_patch->'approval'); end if;
  if p_patch ? 'comments' then allowed := allowed || jsonb_build_object('comments', p_patch->'comments'); end if;
  if p_patch ? 'change'   then allowed := allowed || jsonb_build_object('change', p_patch->'change'); end if;
  -- Budget nur übernehmen, wenn es genau der vorgeschlagenen Änderung entspricht
  if p_patch ? 'budget' and (cur->'change'->>'budget')::numeric = (p_patch->>'budget')::numeric then
    allowed := allowed || jsonb_build_object('budget', (p_patch->>'budget')::numeric);
  end if;
  update campaigns set status = st, data = data || allowed, updated_at = now() where id = p_id;
  insert into events (type, client_id, payload) values ('campaign.' || st, my_client(), jsonb_build_object('campaign', p_id));
end $$;

-- ---------------------------------------------------------------------------
-- Öffentlicher Fragebogen (ohne Login) – nur mit gültigem Token
create function token_client(p_token text) returns bigint language sql stable security definer set search_path = public as
  $$ select client_id from onboarding_tokens where token = p_token and expires_at > now() $$;

create function onboarding_form_get(p_token text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'client', c.name, 'clientId', c.id, 'done', t.used_at is not null,
    'pos', b.data->>'pos', 'aud', b.data->>'aud', 'colors', b.data->'colors', 'tags', b.data->>'tags',
    'goal', c.data->>'goal', 'contact', c.data->>'contact', 'email', c.data->'firma'->>'email',
    'proposal', (b.data->'proposal') is not null and b.data->'proposal' <> 'null'::jsonb)
  from onboarding_tokens t join clients c on c.id = t.client_id left join brands b on b.client_id = c.id
  where t.token = p_token and t.expires_at > now()
$$;

create function onboarding_form_submit(p_token text, p_answers jsonb, p_files jsonb default '[]')
returns boolean language plpgsql security definer set search_path = public as $$
declare cid bigint; cname text; d text;
  mon text[] := array['Jän.','Feb.','März','Apr.','Mai','Juni','Juli','Aug.','Sep.','Okt.','Nov.','Dez.'];
begin
  select client_id into cid from onboarding_tokens where token = p_token and expires_at > now() and used_at is null;
  if cid is null then return false; end if;
  select name into cname from clients where id = cid;
  d := extract(day from now() at time zone 'Europe/Vienna')::int || '. ' || mon[extract(month from now() at time zone 'Europe/Vienna')::int];
  insert into brands (client_id, data) values (cid, '{}') on conflict (client_id) do nothing;
  update brands set data = data
      || jsonb_strip_nulls(jsonb_build_object(
           'pos',   nullif(p_answers->>'pos',''),
           'aud',   nullif(p_answers->>'aud',''),
           'tone',  nullif(p_answers->>'tone',''),
           'tags',  nullif(p_answers->>'tags',''),
           'dos',   case when jsonb_array_length(coalesce(p_answers->'dos','[]')) > 0 then p_answers->'dos' end,
           'donts', case when jsonb_array_length(coalesce(p_answers->'donts','[]')) > 0 then p_answers->'donts' end,
           'colors',case when jsonb_array_length(coalesce(p_answers->'colors','[]')) > 0 then p_answers->'colors' end))
      || jsonb_build_object(
           'proposal', null,
           'onb', coalesce(data->'onb','{}') || '{"brand":true}',
           'onbForm', coalesce(data->'onbForm','{}') || jsonb_build_object('doneAt', d, 'approver', p_answers->>'approver', 'speed', p_answers->>'speed'),
           'files', coalesce(data->'files','[]') || coalesce(p_files,'[]'),
           'ob', jsonb_set(coalesce(data->'ob','{"step":0,"st":{},"d":{}}'), '{d}',
                   coalesce(data->'ob'->'d','{}') || jsonb_strip_nulls(jsonb_build_object(
                     'tones', p_answers->'tones', 'toneNote', p_answers->>'toneNote',
                     'approverName', nullif(p_answers->>'approverName',''), 'approverEmail', nullif(p_answers->>'approverEmail',''),
                     'speed', p_answers->>'speed'))),
           'learned', jsonb_build_array(jsonb_build_object('text', 'Vom Kunden ausgefüllt: Ziel „' || coalesce(p_answers->>'goal','') || '“ · Freigaben durch ' || coalesce(p_answers->>'approver',''), 'src', 'Onboarding-Formular', 'at', 'Heute'))
                      || coalesce(data->'learned','[]')),
      updated_at = now()
   where client_id = cid;
  update clients set data = data || jsonb_build_object('goal', coalesce(nullif(p_answers->>'goal',''), data->>'goal')), updated_at = now() where id = cid;
  update onboarding_tokens set used_at = now() where token = p_token;
  insert into tasks (id, client_id, for_role, done, data)
  values ((extract(epoch from clock_timestamp())*1000)::bigint, cid, 'smm', false,
          jsonb_build_object('kind','onbform','clientId',cid,'title', cname || ' hat das Onboarding-Formular ausgefüllt',
                             'sub','Social · Markenprofil prüfen, erste Konzepte freigeben','for','smm','go','onb:' || cid,'done',false));
  insert into events (type, client_id, payload, actor) values ('onboarding.form_submitted', cid, '{}', null);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Ausführungsrechte: standardmäßig niemand, dann gezielt
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function my_role(), my_client(), is_team(), is_role(variadic app_role[]) to authenticated;
grant execute on function kunde_update_post(bigint, text, jsonb), kunde_update_campaign(bigint, jsonb) to authenticated;
grant execute on function onboarding_form_get(text), onboarding_form_submit(text, jsonb, jsonb), token_client(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dateien: Bucket „brand-files“ (privat). Pfade: <client_id>/<datei> bzw. inbox/<token>/<datei> (Fragebogen)
create policy bf_team_sel on storage.objects for select using (bucket_id = 'brand-files' and is_team());
create policy bf_kunde_sel on storage.objects for select using (bucket_id = 'brand-files' and is_role('kunde')
  and (storage.foldername(name))[1] = my_client()::text);
create policy bf_team_ins on storage.objects for insert with check (bucket_id = 'brand-files' and is_team());
create policy bf_team_del on storage.objects for delete using (bucket_id = 'brand-files' and is_role('admin','smm','grafik'));
create policy bf_inbox_ins on storage.objects for insert to anon, authenticated with check (bucket_id = 'brand-files'
  and (storage.foldername(name))[1] = 'inbox' and token_client((storage.foldername(name))[2]) is not null);
update storage.buckets set file_size_limit = 52428800 where id = 'brand-files';

-- Realtime
alter publication supabase_realtime add table clients, brands, posts, campaigns, suggestions, tasks, profiles, invites, settings;
