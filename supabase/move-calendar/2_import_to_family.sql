-- 개인 달력 옮기기 2단계: 가족 프로젝트로 가져오기
-- ★ 가족 프로젝트(family, 주소 qgotxqbmcxulneqdjvav)의 SQL Editor 에서 실행하세요.
-- ★ 먼저 migrations/004_my_calendar.sql 을 실행해 둬야 해요.
--
-- 할 일 두 가지:
--   (가) 아래 '여기에_붙여넣기' 글자를 지우고, 1단계에서 복사한 내보내기 칸 내용을 그 자리에 붙여넣기
--        ($내보내기_7f3k$ 표시는 지우지 마세요)
--   (나) 예전 달력 로그인 이메일이 가족 채팅 이메일과 "다르면" 아래 바꿀_이메일 칸에 가족 채팅 이메일을 적기
--        (같으면 '' 그대로 두기)
--
-- 여러 번 실행해도 같은 일정이 두 번 들어가지 않아요(같은 id 는 건너뜀).

with settings as (
  select ''::text as 바꿀_이메일,
         $내보내기_7f3k$여기에_붙여넣기$내보내기_7f3k$::jsonb as j
),
owners as (
  select x.email as old_email,
         (select u.id from auth.users u
           where lower(u.email) = lower(coalesce(nullif(btrim(s.바꿀_이메일), ''), x.email))) as user_id
  from settings s,
       (select r->>'email' as email from settings, jsonb_array_elements(j->'events') r
        union
        select r->>'email' from settings, jsonb_array_elements(j->'memos') r) x
),
ins_events as (
  insert into public.events (id, user_id, date, title, start_time, end_time, cat, note, created_at, updated_at)
  select r.id, o.user_id, r.date, r.title, r.start_time, r.end_time, r.cat, r.note, r.created_at, r.updated_at
  from settings s,
       jsonb_to_recordset(s.j->'events') as r(id uuid, email text, date date, title text, start_time text,
                                              end_time text, cat text, note text,
                                              created_at timestamptz, updated_at timestamptz)
  join owners o on o.old_email is not distinct from r.email
  where o.user_id is not null
  on conflict (id) do nothing
  returning 1
),
ins_memos as (
  insert into public.memos (id, user_id, title, body, cat, date, created_at, updated_at)
  select r.id, o.user_id, r.title, r.body, r.cat, r.date, r.created_at, r.updated_at
  from settings s,
       jsonb_to_recordset(s.j->'memos') as r(id uuid, email text, title text, body text, cat text, date date,
                                             created_at timestamptz, updated_at timestamptz)
  join owners o on o.old_email is not distinct from r.email
  where o.user_id is not null
  on conflict (id) do nothing
  returning 1
)
select (select count(*) from ins_events) as 새로_넣은_일정,
       (select count(*) from ins_memos)  as 새로_넣은_메모,
       coalesce((select string_agg(coalesce(old_email, '(이메일 없음)'), ', ') from owners where user_id is null), '')
         as 계정을_못_찾은_이메일;
-- 계정을_못_찾은_이메일 칸이 비어 있으면 성공이에요.
-- 이메일이 보이면: 그 이메일의 계정이 가족 프로젝트에 없다는 뜻 → (나)에 가족 채팅 이메일을 적고 다시 실행.
