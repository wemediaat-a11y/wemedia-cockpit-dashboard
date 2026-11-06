alter table invites add column if not exists data jsonb not null default '{}';
