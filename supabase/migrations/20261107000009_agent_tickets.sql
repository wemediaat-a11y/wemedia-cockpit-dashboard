-- Kurzlebige Tickets für Server-Agenten (Figma-Agent): nur per SQL (postgres/service role) anlegbar, nie über die API lesbar.
create table if not exists agent_tickets (token text primary key, purpose text not null default 'figma', expires_at timestamptz not null default now() + interval '30 minutes', created_at timestamptz default now());
alter table agent_tickets enable row level security;
revoke all on agent_tickets from anon, authenticated;
create index if not exists agent_tickets_exp on agent_tickets (expires_at);
-- (agent_secrets wurde ebenfalls angelegt, wird aber nicht verwendet)
