# 우리 가족 채팅 — Claude Code 작업 안내

가족끼리만 쓰는 채팅 + 가족 달력 PWA. 빌드 과정 없는 순수 HTML/CSS/JS(ES 모듈) + Supabase.
사용자는 한국어를 쓰며 개발 경험이 많지 않으므로, **설명과 안내는 한국어로, 단계별로 쉽게** 해 주세요.
대시보드 작업(SQL 실행, Secrets 등)은 사용자가 직접 하므로 "어디를 눌러 무엇을 붙여넣는지"까지 안내합니다.

## 운영 정보 (모두 공개돼도 되는 값)

| 항목 | 값 |
|---|---|
| 앱 주소 | https://modawn3.github.io/family-chat/ |
| GitHub 저장소 | `modawn3/family-chat` (Public), Pages: main 브랜치 / (root) |
| Supabase 프로젝트 | ref `qgotxqbmcxulneqdjvav` (무료 플랜, 이름 family) |
| 알림 함수 | Edge Function `send-push` (JWT 검증 꺼짐, `x-push-secret` 헤더로 보호) |
| 사용 기기 | 안드로이드 폰 2, 갤럭시 탭, 아이패드(Safari 홈 화면 앱), 윈도우 노트북 여러 대 |

**절대 저장소에 넣으면 안 되는 것**: Supabase service_role/secret 키, VAPID 비밀 키(43자),
PUSH_SECRET, DB 비밀번호, 가족 실제 이메일. 저장소가 Public이고 GitHub Pages가 저장소의 모든 파일을 웹에 공개합니다.
- `config.js`는 저장소에만 있고(사용자가 직접 채움) 공개용 값만 들어 있음: Project URL, publishable 키, VAPID 공개 키(87자).
  이 파일은 덮어쓰지 마세요. `app.js`의 `secretKeyProblem()`이 비밀 키가 들어가면 앱을 멈추고 경고합니다.
- 가족 명단(이메일)은 DB의 `chat.family_members`에만 있음. `supabase/schema.sql`의 명단은 예시 값으로 유지.

## 파일 구조

```
index.html          화면 뼈대 (로그인 / 채팅·달력 탭 / 일정 편집 dialog)
app.js              로그인, 채팅, 사진, 읽음 표시, 알림 구독, 탭, 이모티콘, 설치 안내
calendar.js         달력(월 보기, 반복 일정 계산 occurrences(), 일정 편집) — 순수 날짜 함수는 export 되어 있어 node로 테스트 가능
stickers.js         이모티콘 목록 (+ STICKER_VERSION)
stickers/*.webp     이모티콘 파일 (tools/make-stickers.py 로 생성)
style.css           디자인 토큰(:root 변수) + 다크 모드
sw.js               서비스 워커: 앱 파일 캐시(CACHE 버전), 사진·이모티콘 기기 저장, 푸시 알림 표시
manifest.webmanifest, icons/   PWA 설치 정보
config.js           (저장소에만 있음, 이 패키지엔 없음) 공개 설정값
supabase/schema.sql             전체 DB 설정 (새 프로젝트에 처음 설치할 때. 여러 번 실행해도 안전)
supabase/migrations/00N_*.sql   기존 DB에 적용하는 변경분
supabase/functions/send-push/index.ts   푸시 발송 함수 (Deno)
tools/vapid-keys.html           VAPID 키 생성 (브라우저에서 열기)
tools/make-stickers.py          GIF → 움직이는 WebP 이모티콘 변환 + stickers.js 등록
docs/SETUP.md                   처음 설치 안내서 (사용자용)
docs/HISTORY.md                 지금까지의 결정과 이유, 겪은 문제
```

## 데이터 구조 (스키마 `chat`, 다른 앱과 섞이지 않게 분리)

- `family_members(email PK, display_name, user_id)` — 여기 있는 이메일만 가입 가능
- `messages(id, user_id, content, image_path, thumb_path, image_width, image_height, kind, event_id, sticker, created_at)`
  - `kind`: `text` | `event_new` | `event_edit` | `sticker` (check 제약 `messages_kind_check`)
  - 일정 메시지는 `event_id`로 카드 표시, 일정이 지워지면 `content` 글자로 표시
  - 이모티콘은 `sticker`에 id만 저장(파일은 앱에 있음 → Supabase 용량 0), `content`는 "(이모티콘) 이름"(푸시 본문용)
- `events(id, title, start_date, end_date, all_day, start_time, end_time, who text[], repeat, memo, created_by)`
  - 날짜는 시간대 없는 `date`/`time` (가족이 모두 한국). `who`는 가족 이름 배열, 비면 "가족 모두"
  - `repeat`: none/weekly/monthly/yearly — 반복 전개는 클라이언트 `occurrences()`에서 함
- `read_status(user_id, last_read_at)` — 안 읽은 사람 수 계산
- `push_subscriptions(endpoint PK, user_id, p256dh, auth)` — 함수(`save_push_subscription` 등)로만 접근
- `app_config(key, value)` — `push_function_url`, `push_secret` (앱에서 읽기 불가)
- 사진: Storage 버킷 `chat-images`(비공개), 경로 `<user_id>/<uuid>.jpg` + 미리보기 `<uuid>_t.jpg`

보안: 모든 테이블 RLS, 판정 함수 `chat.is_family()`. `auth.users` 트리거 `on_auth_user_created_chat`가
명단에 없는 이메일 가입을 **프로젝트 전체에서** 거부함(다른 앱을 같은 프로젝트에 넣을 때 주의).
Data API 화면의 "Exposed tables 0 of 6"은 의도된 것(권한을 직접 좁게 줬기 때문) — 토글하지 말 것.

## 작업 규칙

1. **앱 파일(js/css/html)을 바꾸면 `sw.js`의 `CACHE = "family-chat-vN"` 숫자를 올린다.** 안 올리면 기기들이 예전 파일을 씀.
2. 이모티콘 추가는 `python tools/make-stickers.py a.gif id "이름"`. 기존 파일을 같은 이름으로 교체했을 때만 `STICKER_VERSION`을 올림.
3. **DB 변경**: `supabase/migrations/00N_설명.sql`을 새로 만들고(반복 실행해도 안전하게: `if not exists`, `drop ... if exists`),
   같은 내용을 `schema.sql`에도 반영. 사용자는 SQL Editor에 붙여넣어 실행함 — 안내할 때 "``` 줄은 빼고 복사" 꼭 언급.
   앱 코드는 마이그레이션 전/후 모두 동작하게(예: `thumbColumnMissing` 처리) 만드는 것을 선호.
4. **Edge Function 변경**: 사용자가 대시보드 Edge Functions → send-push → Code에 붙여넣고 Deploy.
   함수 주소를 브라우저로 GET 하면 `{"ok":true}` 또는 설정 문제를 알려줌.
5. **배포**: main에 push → GitHub Pages가 1~2분 뒤 반영. 기기에서는 앱을 완전히 닫았다 열어야 새 버전.
6. 외부 라이브러리는 CDN(`cdn.jsdelivr.net`)의 supabase-js@2 ESM과 Pretendard 글꼴만 사용. 빌드 도구 도입은 사용자와 상의.
7. 사용자에게 보내는 메시지·문구는 한국어. 코드 주석도 한국어로 통일되어 있음.

## 테스트 방법 (이전 작업에서 쓰던 방식)

- 문법: `node --check app.js` (ES 모듈이라 .mjs로 복사해서 검사해도 됨)
- 날짜/반복 로직: `calendar.js`의 `occurrences`, `whenText` 등을 node에서 import 해 assert
- DB/RLS: 로컬 Postgres에 `auth.uid()`/`auth.jwt()`/`storage`/`net.http_post`를 흉내 낸 stub을 만들고 schema.sql 실행 →
  `set role authenticated` + `request.jwt.claim.sub` 설정으로 가족/외부인/비로그인 권한 확인
- 화면: Playwright로 정적 서버를 띄우고 supabase-js ESM을 가짜 모듈로 route 해서 스크린샷(모바일/PC, 라이트/다크)
- 서비스 워커 캐시 확인 시 `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` 필요
- 푸시 함수: Deno로 로컬 실행해 GET 응답과 설정 오류 메시지 확인

## 알려진 환경 문제 (사용자 문의가 오면 먼저 확인)

- **회사 PC의 Chrome**: 알림 켤 때 "Registration failed - push service error" → 회사망이 구글 푸시(FCM)를 막음. **Edge로 설치하면 됨**.
- **아이패드**: Safari → 공유 → 홈 화면에 추가 후 **홈 화면 앱에서 다시 로그인**해야 하고, 알림도 그 안에서만 켤 수 있음 (iPadOS 16.4+).
- **카카오톡에서 링크를 열면** 내부 브라우저라 설치/알림 불가 → "다른 브라우저로 열기".
- **내가 보낸 메시지는 내 다른 기기에도 알림이 안 감**(의도된 동작). 알림 테스트는 다른 가족 계정으로.
- 새 기능이 한 기기에서만 안 보이면 예전 파일 캐시 → 앱을 최근 목록에서 완전히 종료 후 재실행(2번).
- Supabase 무료 플랜: 7일간 DB 활동이 없으면 일시정지(대시보드에서 Resume). 한도: DB 500MB, Storage 1GB, 전송 5GB/월.
  사진 전송량을 줄이려고 미리보기 + 서비스 워커 사진 저장을 넣어 둠.

## 마이그레이션 적용 현황 (2026-10-10 기준)

`schema.sql`(일정 포함 버전) → `002_thumbnails` → `003_stickers` 모두 적용된 것으로 보임(이모티콘 정상 동작 확인됨).
확인 SQL: `select column_name from information_schema.columns where table_schema='chat' and table_name='messages';`
→ `thumb_path`, `sticker`가 있으면 적용 완료.

## 앞으로 할 일 / 아이디어

- **개인 일정 달력 앱과 합치기** (사용자의 다음 목표). 개인 달력은 **별도 Supabase 프로젝트**에 있는 기존 앱.
  합치기 전에 사용자와 정할 것: 같은 Supabase 프로젝트로 옮길지(스키마 분리 예: `calendar`), 개인 일정의 공개 범위(나만/가족),
  기존 `chat.events`(가족 일정)와의 관계, 로그인 계정 통합, 가입 거부 트리거가 개인 앱에 미치는 영향. 무료 플랜은 활성 프로젝트 2개 제한.
- 새 버전 감지 시 "새 버전이 있어요 — 눌러서 새로고침" 안내 (제안만 하고 아직 안 만듦)
- 일정 당일 아침 푸시 알림 (pg_cron + send-push 확장, 제안만 함)
- 사진 저장 공간이 차면 오래된 사진 정리 기능
- 음력 명절(설날·추석)은 자동 표시 안 함 — 일정으로 등록하도록 안내 중
