-- Minimal schema for MARX

create extension if not exists pgcrypto;

create table if not exists users (
  id bigserial primary key,
  nickname text not null unique,
  password_hash text not null,
  password_salt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invites (
  id bigserial primary key,
  code text not null unique,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  used_by bigint references users(id) on delete set null,
  used_at timestamptz,
  expires_at timestamptz,
  max_uses int not null default 1,
  uses int not null default 0
);

create table if not exists dialogs (
  id bigserial primary key,
  kind text not null, -- general | private
  member_a bigint references users(id) on delete set null,
  member_b bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists dialogs_general_unique on dialogs(kind) where kind = 'general';
create unique index if not exists dialogs_private_unique on dialogs(kind, member_a, member_b) where kind = 'private';
create index if not exists dialogs_private_lookup_idx on dialogs(member_a, member_b) where kind = 'private';

create table if not exists messages (
  id bigserial primary key,
  dialog_id bigint references dialogs(id) on delete cascade,
  sender_id bigint references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists messages_dialog_created_idx on messages(dialog_id, created_at desc);
create index if not exists messages_expires_idx on messages(expires_at);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id bigint references users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text
);
