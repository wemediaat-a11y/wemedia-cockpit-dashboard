-- Monats-Workflow: Themenfreigabe und Monats-Briefing durch den Kunden.
-- Beitrags-Status „themen“ = Thema liegt beim Kunden zur Freigabe (vor der Produktion).

create policy p_sel_themen on posts for select using (is_role('kunde') and client_id = my_client() and status = 'themen');

-- Kunde bestätigt die Themen eines Monats: freigegebene gehen in die Produktion („briefing“),
-- abgelehnte zurück an Social Media („konzept“ mit Notiz). Kampagnen-Budgets im selben Schritt.
create function kunde_month_themes(p_ym text, p_ok bigint[], p_notes jsonb, p_camp_ok bigint[], p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid bigint := my_client(); n_ok int := 0; n_no int := 0; r record;
begin
  if not is_role('kunde') or cid is null then raise exception 'nur für Kunden'; end if;
  if p_ym !~ '^\d{4}-\d{2}$' then raise exception 'Monat ungültig'; end if;
  for r in select id, data from posts where client_id = cid and status = 'themen' and data->>'date' like p_ym || '%' loop
    if r.id = any(coalesce(p_ok, '{}')) then
      update posts set status = 'briefing', data = data || jsonb_build_object('status','briefing','themeOk', now()::date), updated_at = now() where id = r.id;
      n_ok := n_ok + 1;
    else
      update posts set status = 'konzept', data = data || jsonb_build_object('status','konzept','themeNote', coalesce(p_notes->>(r.id::text), 'Bitte anderes Thema')), updated_at = now() where id = r.id;
      n_no := n_no + 1;
    end if;
  end loop;
  for r in select id, data from campaigns where client_id = cid and status = 'freigabe' and coalesce(data->>'month','') = p_ym loop
    if r.id = any(coalesce(p_camp_ok, '{}')) then
      update campaigns set status = 'freigegeben', data = data || jsonb_build_object('status','freigegeben','approval', jsonb_build_object('by','Kunde','at', now()::date)), updated_at = now() where id = r.id;
    else
      update campaigns set status = 'aenderung', data = data || jsonb_build_object('status','aenderung',
        'comments', coalesce(data->'comments','[]'::jsonb) || jsonb_build_array(jsonb_build_object('who','Kunde','text', coalesce(p_notes->>(r.id::text),'Bitte anpassen'),'at','Heute'))), updated_at = now() where id = r.id;
    end if;
  end loop;
  update brands set data = jsonb_set(coalesce(data,'{}'::jsonb), array['months', p_ym, 'themes'],
      jsonb_build_object('at', now()::date, 'ok', n_ok, 'no', n_no, 'note', coalesce(p_note,'')), true), updated_at = now()
    where client_id = cid and data ? 'months' and data->'months' ? p_ym;
  insert into events (type, client_id, payload) values ('month.themes', cid, jsonb_build_object('ym', p_ym, 'ok', n_ok, 'no', n_no));
  return jsonb_build_object('ok', n_ok, 'no', n_no);
end $$;

-- Kunde liefert sein Monats-Briefing (Text + Links) selbst im Portal.
create function kunde_month_brief(p_ym text, p_text text, p_links jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cid bigint := my_client(); d jsonb; months jsonb; m jsonb;
begin
  if not is_role('kunde') or cid is null then raise exception 'nur für Kunden'; end if;
  if p_ym !~ '^\d{4}-\d{2}$' then raise exception 'Monat ungültig'; end if;
  select data into d from brands where client_id = cid;
  if d is null then raise exception 'Markenprofil fehlt'; end if;
  months := coalesce(d->'months', '{}'::jsonb);
  m := coalesce(months->p_ym, '{}'::jsonb) || jsonb_build_object('client',
    jsonb_build_object('text', left(coalesce(p_text,''), 4000), 'links', coalesce(p_links,'[]'::jsonb), 'at', now()::date));
  update brands set data = d || jsonb_build_object('months', months || jsonb_build_object(p_ym, m)), updated_at = now()
  where client_id = cid;
  insert into events (type, client_id, payload) values ('month.brief', cid, jsonb_build_object('ym', p_ym));
end $$;

revoke all on function kunde_month_themes(text, bigint[], jsonb, bigint[], text) from public, anon;
revoke all on function kunde_month_brief(text, text, jsonb) from public, anon;
grant execute on function kunde_month_themes(text, bigint[], jsonb, bigint[], text), kunde_month_brief(text, text, jsonb) to authenticated;
