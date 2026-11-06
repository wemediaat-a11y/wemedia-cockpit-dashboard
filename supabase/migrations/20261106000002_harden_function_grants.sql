revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant execute on function public.my_role(), public.my_client(), public.is_team(), public.is_role(variadic public.app_role[]) to authenticated;
grant execute on function public.kunde_post_decision(uuid, boolean, text), public.kunde_campaign_decision(uuid, boolean, text) to authenticated;
grant execute on function public.onboarding_form_get(text), public.onboarding_form_submit(text, jsonb) to anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
