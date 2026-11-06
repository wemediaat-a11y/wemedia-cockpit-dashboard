insert into role_access values ('performance', '{home,performance,portal}') on conflict (role) do nothing;
create or replace function is_team() returns boolean language sql stable security definer set search_path = public as
  $$ select is_role('admin','sales','smm','grafik','performance') $$;
grant execute on function is_team() to authenticated;
