-- 업데이트 009: 작은 정리 (여러 번 실행해도 안전해요)
-- 1) 보안 규칙에서 로그인 확인(auth.uid())을 줄마다가 아니라 한 번만 계산하도록 (select ...) 로 감쌈
--    (Supabase 점검 도구의 auth_rls_initplan 경고 해결. 규칙 내용은 그대로)
alter policy "own events"       on public.events       using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "own memos"        on public.memos        using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "own series"       on public.event_series using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "own todos"        on public.todos        using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "delete own messages"      on chat.messages using (user_id = (select auth.uid()));
alter policy "family can send messages" on chat.messages with check (chat.is_family() and user_id = (select auth.uid()));
alter policy "family can add events"    on chat.events   with check (chat.is_family() and created_by = (select auth.uid()));

-- 2) 자동 작업(날씨·공휴일) 실행 기록은 일주일만 남기고 매주 일요일 새벽에 지움
select cron.schedule('cleanup-cron-history', '30 19 * * 6',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);
