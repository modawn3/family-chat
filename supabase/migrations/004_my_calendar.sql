-- 업데이트 4: 개인 달력(나의 달력 메모장)을 가족 프로젝트로 옮겨오기
-- 이미 schema.sql 을 실행한 가족 프로젝트에서 SQL Editor 로 한 번만 실행하세요. (여러 번 실행해도 괜찮아요)
--
-- 개인 달력 테이블은 예전 프로젝트와 "이름·칸을 똑같이" public 스키마에 만들어요.
-- 그래서 안드로이드·바탕화면·아이패드 위젯은 Supabase 주소와 키만 바꾸면 그대로 동작해요.
-- 예약 실행 암호(cron_secret)는 이 파일에 없고, 안내서(docs/MERGE-CALENDAR.md)에 따라 DB에만 넣어요.

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
create extension if not exists pg_net with schema extensions;

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

-- 확인용: 테이블 4개와 예약 2개가 보이면 성공
select '테이블' as 종류, table_name as 이름 from information_schema.tables
where table_schema = 'public' and table_name in ('events', 'memos', 'holidays', 'weather')
union all
select '예약', jobname from cron.job where jobname in ('sync-holidays-daily', 'sync-weather');
