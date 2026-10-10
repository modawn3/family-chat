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

-- =====================================================================
-- 2. 개인 달력 (내 달력, my/ 화면과 위젯들이 씀) — migrations/004_my_calendar.sql 과 같은 내용
--    예약 실행 암호는 chat.app_config 의 'cron_secret' (docs/MERGE-CALENDAR.md 2단계)
-- =====================================================================
-- ---------------------------------------------------------------------
-- 1) 테이블 (예전 01_tables.sql + 04_memo_date.sql + 06_weather.sql 과 같은 모양)
-- ---------------------------------------------------------------------

-- 내 일정
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  title       text not null,
  start_time  text,                 -- 'HH:MM' 또는 비움(종일)
  end_time    text,
  cat         text not null default 'etc' check (cat in ('work','personal','etc')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists events_user_date on public.events (user_id, date);

-- 내 메모 (date 가 있으면 달력에도 표시)
create table if not exists public.memos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text,
  body        text,
  cat         text not null default 'etc' check (cat in ('work','personal','etc')),
  date        date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.memos add column if not exists date date;
create index if not exists memos_user_updated on public.memos (user_id, updated_at desc);
create index if not exists memos_user_date on public.memos (user_id, date);

-- 공휴일 (모두 같이 보는 공용 자료, sync-holidays 함수가 채움)
create table if not exists public.holidays (
  date        date primary key,
  name        text not null,
  source      text not null default 'builtin',   -- builtin / api / manual
  updated_at  timestamptz not null default now()
);

-- 날씨 (모두 같이 보는 공용 자료, sync-weather 함수가 채움)
create table if not exists public.weather (
  date        date primary key,
  code        text not null,          -- clear / partly / cloudy / rain / sleet / snow / shower
  wf          text not null,          -- 맑음, 구름많음, 흐림, 비 ...
  tmin        numeric,
  tmax        numeric,
  pop         int,                    -- 강수확률(%)
  src         text not null,          -- short(단기예보) / mid(중기예보)
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) 보안 규칙: 내 일정·메모는 나만, 공휴일·날씨는 로그인한 가족이 읽기만
-- ---------------------------------------------------------------------
alter table public.events   enable row level security;
alter table public.memos    enable row level security;
alter table public.holidays enable row level security;
alter table public.weather  enable row level security;

drop policy if exists "own events"    on public.events;
drop policy if exists "own memos"     on public.memos;
drop policy if exists "read holidays" on public.holidays;
drop policy if exists "read weather"  on public.weather;

create policy "own events" on public.events for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own memos" on public.memos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "read holidays" on public.holidays for select to authenticated using (true);
create policy "read weather"  on public.weather  for select to authenticated using (true);

revoke all on public.events, public.memos, public.holidays, public.weather from anon, authenticated;
grant select, insert, update, delete on public.events, public.memos to authenticated;
grant select on public.holidays, public.weather to authenticated;
grant all on public.events, public.memos, public.holidays, public.weather to service_role;

-- ---------------------------------------------------------------------
-- 3) 처음 공휴일 (2026~2027). sync-holidays 함수가 공식 자료로 덮어써요
-- ---------------------------------------------------------------------
insert into public.holidays (date, name) values
  ('2026-01-01', '신정'), ('2026-02-16', '설날 연휴'), ('2026-02-17', '설날'), ('2026-02-18', '설날 연휴'),
  ('2026-03-01', '삼일절'), ('2026-03-02', '대체공휴일'), ('2026-05-01', '노동절'), ('2026-05-05', '어린이날'),
  ('2026-05-24', '부처님오신날'), ('2026-05-25', '대체공휴일'), ('2026-06-03', '지방선거일'), ('2026-06-06', '현충일'),
  ('2026-07-17', '제헌절'), ('2026-08-15', '광복절'), ('2026-08-17', '대체공휴일'),
  ('2026-09-24', '추석 연휴'), ('2026-09-25', '추석'), ('2026-09-26', '추석 연휴'),
  ('2026-10-03', '개천절'), ('2026-10-05', '대체공휴일'), ('2026-10-09', '한글날'), ('2026-12-25', '성탄절'),
  ('2027-01-01', '신정'), ('2027-02-06', '설날 연휴'), ('2027-02-07', '설날'), ('2027-02-08', '설날 연휴'),
  ('2027-02-09', '대체공휴일'), ('2027-03-01', '삼일절'), ('2027-05-01', '노동절'), ('2027-05-03', '대체공휴일'),
  ('2027-05-05', '어린이날'), ('2027-05-13', '부처님오신날'), ('2027-06-06', '현충일'),
  ('2027-07-17', '제헌절'), ('2027-07-19', '대체공휴일'), ('2027-08-15', '광복절'), ('2027-08-16', '대체공휴일'),
  ('2027-09-14', '추석 연휴'), ('2027-09-15', '추석'), ('2027-09-16', '추석 연휴'),
  ('2027-10-03', '개천절'), ('2027-10-04', '대체공휴일'), ('2027-10-09', '한글날'), ('2027-10-11', '대체공휴일'),
  ('2027-12-25', '성탄절'), ('2027-12-27', '대체공휴일')
on conflict (date) do nothing;

-- ---------------------------------------------------------------------
-- 4) 공휴일·날씨 자동 갱신 예약
--    함수 주소는 공개돼도 되는 값, 암호는 chat.app_config 의 'cron_secret' 에서 읽어요.
--    (암호를 아직 안 넣었으면 예약이 돌아도 아무것도 안 해요)
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function chat.call_cron_function(fn text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  secret text;
  base   text;
begin
  select value into secret from chat.app_config where key = 'cron_secret';
  if secret is null then
    return null;
  end if;
  select coalesce(
           (select value from chat.app_config where key = 'functions_url'),
           'https://qgotxqbmcxulneqdjvav.supabase.co/functions/v1')
    into base;
  return net.http_post(
    url     := base || '/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function chat.call_cron_function(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('sync-holidays-daily', 'sync-weather');
-- 매일 한국 시간 새벽 3시(= UTC 18시)
select cron.schedule('sync-holidays-daily', '0 18 * * *',
  $$ select chat.call_cron_function('sync-holidays') $$);
-- 날씨: 예전 개인 달력 프로젝트와 같은 시각 (3시간마다, 20분)
select cron.schedule('sync-weather', '20 2,5,8,11,14,17,20,23 * * *',
  $$ select chat.call_cron_function('sync-weather') $$);
