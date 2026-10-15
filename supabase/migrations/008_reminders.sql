-- 업데이트 008: 내 달력 일정·할 일 알림 (안드로이드 「나의 달력」 앱이 휴대폰에서 울림)
-- remind = 몇 분 전에 알릴지. 비어 있으면(null) 알림 없음(기본).
--   일정: 시작 시간 기준 (시간이 없는 일정은 그날 오전 9시 기준)
--   할 일: 마감일 오전 9시 기준
-- 여러 번 실행해도 안전해요.
alter table public.events       add column if not exists remind smallint;
alter table public.todos        add column if not exists remind smallint;
alter table public.event_series add column if not exists remind smallint;

alter table public.events       drop constraint if exists events_remind_check;
alter table public.events       add  constraint events_remind_check       check (remind between 0 and 10080);
alter table public.todos        drop constraint if exists todos_remind_check;
alter table public.todos        add  constraint todos_remind_check        check (remind between 0 and 10080);
alter table public.event_series drop constraint if exists event_series_remind_check;
alter table public.event_series add  constraint event_series_remind_check check (remind between 0 and 10080);
