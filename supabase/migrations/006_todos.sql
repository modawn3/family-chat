-- 업데이트 6: 내 달력 "할 일" 목록
-- SQL Editor 로 한 번만 실행하세요. (여러 번 실행해도 괜찮아요)

create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  done        boolean not null default false,
  done_at     timestamptz,
  due         date,                 -- 마감일 (있으면 달력에도 표시)
  cat         text not null default 'etc' check (cat in ('work','personal','etc')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists todos_user on public.todos (user_id, done, due);

alter table public.todos enable row level security;
drop policy if exists "own todos" on public.todos;
create policy "own todos" on public.todos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.todos from anon, authenticated;
grant select, insert, update, delete on public.todos to authenticated;
grant all on public.todos to service_role;
