-- 업데이트 7: 가족 달력 반복에 "매년 (음력)"과 "매주 요일 여러 개" 추가
-- SQL Editor 로 한 번만 실행하세요. (여러 번 실행해도 괜찮아요)

alter table chat.events drop constraint if exists events_repeat_check;
alter table chat.events add constraint events_repeat_check
  check (repeat in ('none', 'weekly', 'monthly', 'yearly', 'lunar_yearly'));

-- 매주 반복할 요일 (0=일 ~ 6=토). 비어 있으면 시작하는 날의 요일
alter table chat.events add column if not exists weekdays smallint[];

grant update (title, start_date, end_date, all_day, start_time, end_time, who, repeat, weekdays, memo)
  on chat.events to authenticated;
