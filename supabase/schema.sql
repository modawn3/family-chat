-- =====================================================================
--  가족 채팅앱 데이터베이스 설정
--  Supabase 대시보드 → SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
--
--  ★ 실행 전에 아래 "1. 가족 명단" 부분의 이메일과 이름을 실제 가족으로 바꾸세요.
--  ★ 모든 테이블은 chat 스키마에 들어갑니다. 나중에 같은 프로젝트에 다른 앱을
--     만들 때는 calendar, todo 처럼 스키마를 따로 만들면 서로 섞이지 않아요.
-- =====================================================================

create schema if not exists chat;
grant usage on schema chat to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------

-- 가족 명단 (여기 있는 이메일만 계정을 만들고 채팅할 수 있어요)
create table if not exists chat.family_members (
  email        text primary key check (email = lower(email)),
  display_name text not null,
  user_id      uuid unique references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- 가족 일정 (달력)
create table if not exists chat.events (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(btrim(title)) between 1 and 100),
  start_date  date not null,
  end_date    date not null,
  all_day     boolean not null default true,
  start_time  time,
  end_time    time,
  who         text[] not null default '{}',   -- 참여하는 가족 이름 (비어 있으면 가족 모두)
  repeat      text not null default 'none' check (repeat in ('none', 'weekly', 'monthly', 'yearly')),
  memo        text check (char_length(memo) <= 1000),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint event_dates check (end_date >= start_date),
  constraint event_times check (all_day or start_time is not null)
);
create index if not exists events_start_idx on chat.events (start_date);

-- 메시지
create table if not exists chat.messages (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content      text check (char_length(content) <= 4000),
  image_path   text,
  image_width  int,
  image_height int,
  kind         text not null default 'text' check (kind in ('text', 'event_new', 'event_edit')),
  event_id     bigint references chat.events (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint message_not_empty check (coalesce(btrim(content), '') <> '' or image_path is not null)
);
-- 예전 버전으로 이미 만든 경우를 위해
alter table chat.messages add column if not exists kind text not null default 'text'
  check (kind in ('text', 'event_new', 'event_edit'));
alter table chat.messages add column if not exists event_id bigint references chat.events (id) on delete set null;
alter table chat.messages add column if not exists thumb_path text;  -- 채팅 화면용 미리보기 사진
alter table chat.messages add column if not exists sticker text;     -- 이모티콘 이름 (파일은 앱에 있음)
alter table chat.messages drop constraint if exists messages_kind_check;
alter table chat.messages add constraint messages_kind_check
  check (kind in ('text', 'event_new', 'event_edit', 'sticker'));
create index if not exists messages_user_idx on chat.messages (user_id);
create index if not exists messages_event_idx on chat.messages (event_id);

-- 읽음 표시 (각자 마지막으로 읽은 시각)
create table if not exists chat.read_status (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now()
);

-- 기기별 푸시 알림 구독 정보
create table if not exists chat.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- 서버 내부 설정값 (푸시 함수 주소, 비밀값) — 앱에서는 읽을 수 없어요
create table if not exists chat.app_config (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------
-- 함수
-- ---------------------------------------------------------------------

-- 지금 로그인한 사람이 가족인지 확인
create or replace function chat.is_family()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from chat.family_members m
    where m.user_id = auth.uid()
       or m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 새 계정이 만들어질 때: 명단에 없는 이메일이면 거부, 있으면 연결
create or replace function chat.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from chat.family_members where email = lower(new.email)) then
    raise exception '가족 명단(chat.family_members)에 없는 이메일입니다: %', new.email;
  end if;
  update chat.family_members set user_id = new.id where email = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_chat on auth.users;
create trigger on_auth_user_created_chat
  after insert on auth.users
  for each row execute function chat.handle_new_user();

-- 읽음 처리 (서버 시각 기준)
create or replace function chat.mark_read()
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := clock_timestamp();
begin
  if not chat.is_family() then
    raise exception 'not allowed';
  end if;
  insert into chat.read_status (user_id, last_read_at)
  values (auth.uid(), t)
  on conflict (user_id) do update set last_read_at = excluded.last_read_at;
  return t;
end;
$$;

-- 일정 수정 시각 자동 기록
create or replace function chat.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_touch on chat.events;
create trigger events_touch
  before update on chat.events
  for each row execute function chat.touch_updated_at();

-- 이 기기의 알림 구독 저장/삭제
create or replace function chat.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not chat.is_family() then
    raise exception 'not allowed';
  end if;
  insert into chat.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

create or replace function chat.remove_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from chat.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- 새 메시지가 오면 푸시 알림 함수(send-push) 호출
create extension if not exists pg_net with schema extensions;

create or replace function chat.notify_new_message()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  fn_url text;
  secret text;
begin
  select value into fn_url from chat.app_config where key = 'push_function_url';
  select value into secret from chat.app_config where key = 'push_secret';
  if fn_url is null or secret is null then
    return new;  -- 알림 설정 전에는 그냥 넘어가요
  end if;
  perform net.http_post(
    url     := fn_url,
    body    := jsonb_build_object('message_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret)
  );
  return new;
end;
$$;

drop trigger if exists on_message_push on chat.messages;
create trigger on_message_push
  after insert on chat.messages
  for each row execute function chat.notify_new_message();

-- ---------------------------------------------------------------------
-- 보안 규칙 (RLS)
-- ---------------------------------------------------------------------
alter table chat.family_members     enable row level security;
alter table chat.messages           enable row level security;
alter table chat.events             enable row level security;
alter table chat.read_status        enable row level security;
alter table chat.push_subscriptions enable row level security;
alter table chat.app_config         enable row level security;

drop policy if exists "family can read members"  on chat.family_members;
drop policy if exists "family can read messages" on chat.messages;
drop policy if exists "family can send messages" on chat.messages;
drop policy if exists "delete own messages"      on chat.messages;
drop policy if exists "family can read status"   on chat.read_status;
drop policy if exists "family can read events"   on chat.events;
drop policy if exists "family can add events"    on chat.events;
drop policy if exists "family can edit events"   on chat.events;
drop policy if exists "family can delete events" on chat.events;

create policy "family can read members"  on chat.family_members for select to authenticated
  using (chat.is_family());
create policy "family can read messages" on chat.messages for select to authenticated
  using (chat.is_family());
create policy "family can send messages" on chat.messages for insert to authenticated
  with check (chat.is_family() and user_id = auth.uid());
create policy "delete own messages"      on chat.messages for delete to authenticated
  using (user_id = auth.uid());
create policy "family can read status"   on chat.read_status for select to authenticated
  using (chat.is_family());
-- 일정은 가족 누구나 추가/수정/삭제할 수 있어요
create policy "family can read events"   on chat.events for select to authenticated
  using (chat.is_family());
create policy "family can add events"    on chat.events for insert to authenticated
  with check (chat.is_family() and created_by = auth.uid());
create policy "family can edit events"   on chat.events for update to authenticated
  using (chat.is_family()) with check (chat.is_family());
create policy "family can delete events" on chat.events for delete to authenticated
  using (chat.is_family());
-- push_subscriptions, app_config 는 정책이 없으므로 앱에서 직접 접근 불가 (함수로만 사용)

-- 권한
revoke all on all tables in schema chat from anon, authenticated;
grant select                 on chat.family_members, chat.read_status to authenticated;
grant select, insert, delete on chat.messages to authenticated;
grant select, insert, delete on chat.events to authenticated;
grant update (title, start_date, end_date, all_day, start_time, end_time, who, repeat, memo)
  on chat.events to authenticated;
grant all on all tables    in schema chat to service_role;
grant usage, select on all sequences in schema chat to authenticated, service_role;

revoke execute on all functions in schema chat from public, anon;
grant execute on function chat.is_family()                                   to authenticated;
grant execute on function chat.mark_read()                                   to authenticated;
grant execute on function chat.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function chat.remove_push_subscription(text)               to authenticated;
revoke execute on function chat.handle_new_user()    from authenticated;
revoke execute on function chat.notify_new_message() from authenticated;

-- ---------------------------------------------------------------------
-- 사진 저장소
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "family can view chat images"   on storage.objects;
drop policy if exists "family can upload chat images" on storage.objects;
drop policy if exists "delete own chat images"        on storage.objects;

create policy "family can view chat images" on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and chat.is_family());
create policy "family can upload chat images" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and chat.is_family());
create policy "delete own chat images" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and owner_id = (select auth.uid()::text));

-- ---------------------------------------------------------------------
-- 실시간(Realtime) 켜기
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table chat.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table chat.read_status;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table chat.events;
  exception when duplicate_object then null;
  end;
end $$;

-- =====================================================================
-- 1. 가족 명단  ★ 여기를 실제 가족 이메일/이름으로 바꾸세요 (이메일은 소문자로)
-- =====================================================================
insert into chat.family_members (email, display_name) values
  ('dad@example.com',  '아빠'),
  ('mom@example.com',  '엄마'),
  ('kid1@example.com', '첫째'),
  ('kid2@example.com', '둘째')
on conflict (email) do update set display_name = excluded.display_name;

-- 이미 만들어 둔 계정이 있으면 명단과 연결
update chat.family_members m
set user_id = u.id
from auth.users u
where lower(u.email) = m.email and m.user_id is null;
