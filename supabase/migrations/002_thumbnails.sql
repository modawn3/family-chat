-- 업데이트 2: 사진 미리보기(썸네일) 칸 추가
-- 이미 schema.sql 을 실행한 프로젝트에서 SQL Editor 로 한 번만 실행하세요.
alter table chat.messages add column if not exists thumb_path text;
