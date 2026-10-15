-- 업데이트 5: 내 달력 "고정(반복) 일정"
-- SQL Editor 로 한 번만 실행하세요. (여러 번 실행해도 괜찮아요)
--
-- 반복 규칙은 event_series 에 한 줄로 저장하고, 실제 날짜들은 지금처럼 events 에 한 줄씩 만들어 둬요
-- (앞으로 약 1년치. 내 달력을 열 때마다 모자란 만큼 이어서 만들어요).
-- 그래서 안드로이드·바탕화면·아이패드 위젯은 고치지 않아도 반복 일정이 그대로 보여요.

create table if not exists public.event_series (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('weekly', 'monthly', 'yearly', 'lunar_yearly')),
  weekdays    smallint[],           -- 매주일 때 요일(0=일 ~ 6=토)
  start_date  date not null,        -- 반복 시작일 (매월·매년·음력 기준 날짜도 이 날)
  until       date,                 -- 반복 끝나는 날, 비우면 계속
  made_until  date not null,        -- events 에 여기까지 만들어 둠
  title       text not null,
  start_time  text,
  end_time    text,
  cat         text not null default 'etc' check (cat in ('work','personal','etc')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists event_series_user on public.event_series (user_id);

-- 반복으로 만들어진 일정은 어느 반복인지 표시 (반복을 지우면 같이 지워짐)
alter table public.events add column if not exists series_id uuid references public.event_series(id) on delete cascade;
create index if not exists events_series on public.events (series_id, date);

alter table public.event_series enable row level security;
drop policy if exists "own series" on public.event_series;
create policy "own series" on public.event_series for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.event_series from anon, authenticated;
grant select, insert, update, delete on public.event_series to authenticated;
grant all on public.event_series to service_role;
