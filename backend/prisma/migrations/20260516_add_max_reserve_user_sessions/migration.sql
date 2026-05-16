create table if not exists max_reserve_user_sessions (
  user_id integer primary key references users(id) on delete cascade,
  max_session_key text not null,
  rotated_at timestamptz(3) not null,
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now()
);

create index if not exists max_reserve_user_sessions_rotated_idx
  on max_reserve_user_sessions(rotated_at);

create or replace function set_max_reserve_user_sessions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_max_reserve_user_sessions_updated_at on max_reserve_user_sessions;

create trigger trg_max_reserve_user_sessions_updated_at
before update on max_reserve_user_sessions
for each row
execute function set_max_reserve_user_sessions_updated_at();
