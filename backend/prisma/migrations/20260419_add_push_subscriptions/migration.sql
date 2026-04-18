create table if not exists push_subscriptions (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  last_used_at timestamptz(3)
);

create unique index if not exists push_subscriptions_endpoint_key
  on push_subscriptions(endpoint);

create index if not exists push_subscriptions_user_idx
  on push_subscriptions(user_id);

create or replace function set_push_subscriptions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_push_subscriptions_updated_at on push_subscriptions;

create trigger trg_push_subscriptions_updated_at
before update on push_subscriptions
for each row
execute function set_push_subscriptions_updated_at();
