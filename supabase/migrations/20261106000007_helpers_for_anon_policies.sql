-- Storage-Policies werden auch für Gäste (Fragebogen) ausgewertet
grant execute on function my_role(), my_client(), is_team(), is_role(variadic app_role[]) to anon;
