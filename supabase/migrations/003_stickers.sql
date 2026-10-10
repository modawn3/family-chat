-- 업데이트 3: 이모티콘 메시지
-- 이미 schema.sql 을 실행한 프로젝트에서 SQL Editor 로 한 번만 실행하세요. (여러 번 실행해도 괜찮아요)
alter table chat.messages add column if not exists sticker text;
alter table chat.messages drop constraint if exists messages_kind_check;
alter table chat.messages add constraint messages_kind_check
  check (kind in ('text', 'event_new', 'event_edit', 'sticker'));
