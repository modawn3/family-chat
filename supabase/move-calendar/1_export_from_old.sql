-- 개인 달력 옮기기 1단계: 예전 개인 달력 프로젝트에서 내보내기
-- ★ 예전 프로젝트(나의 달력, 주소 wlshvleklbctladudjkd)의 SQL Editor 에서 실행하세요.
-- 결과 칸(내보내기) 하나에 일정·메모가 전부 글자로 나와요. 그 칸을 통째로 복사해 두세요.
-- 이 SQL 은 읽기만 하고 아무것도 바꾸지 않아요.
select json_build_object(
  'events', (select coalesce(json_agg(json_build_object(
               'id', e.id, 'email', lower(u.email), 'date', e.date, 'title', e.title,
               'start_time', e.start_time, 'end_time', e.end_time, 'cat', e.cat, 'note', e.note,
               'created_at', e.created_at, 'updated_at', e.updated_at)), '[]'::json)
             from public.events e left join auth.users u on u.id = e.user_id),
  'memos',  (select coalesce(json_agg(json_build_object(
               'id', m.id, 'email', lower(u.email), 'title', m.title, 'body', m.body, 'cat', m.cat,
               'date', m.date, 'created_at', m.created_at, 'updated_at', m.updated_at)), '[]'::json)
             from public.memos m left join auth.users u on u.id = m.user_id)
)::text as 내보내기,
(select count(*) from public.events) as 일정_개수,
(select count(*) from public.memos)  as 메모_개수;
