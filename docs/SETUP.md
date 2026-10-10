# 우리 가족 채팅 (PWA + Supabase)

> **저장소 구조 안내**: 이 저장소에서는 아래 설명의 `app` 폴더 내용이 **저장소 맨 위**에 있어요.
> 예) `app/config.js` → `config.js`, `app/sw.js` → `sw.js`. 처음 설치 이후 변경분 SQL은 `supabase/migrations/`에 있어요.


노트북, 안드로이드 폰, 갤럭시 탭, 아이패드에서 모두 쓰는 가족 전용 채팅앱이에요.
앱스토어 등록이나 애플 개발자 계정 없이, 무료로 운영할 수 있어요.

**기능**: 가족 단체방 · 실시간 메시지 · 사진 전송(자동 압축) · 읽음 표시(안 읽은 사람 수) · 새 메시지 푸시 알림 · 내 메시지 삭제 · 다크 모드 · 비밀번호 변경 · **가족 달력**

```
family-chat/
├─ app/                         ← 웹사이트로 올릴 폴더 (이것만 배포)
│  ├─ config.js                 ← ★ 내 Supabase 주소/키 입력
│  ├─ index.html, app.js, style.css, sw.js, manifest.webmanifest
│  └─ icons/
├─ supabase/
│  ├─ schema.sql                ← DB 설정 (SQL Editor에서 실행)
│  └─ functions/send-push/index.ts  ← 푸시 알림 서버 함수
└─ tools/vapid-keys.html        ← 알림용 키 만들기 (브라우저로 열기)
```

---

## 설정 순서 (약 30분)

### 1. Supabase 프로젝트 만들기
1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. 이름: `family` 등 자유, 지역(Region): **Northeast Asia (Seoul)**, DB 비밀번호는 아무거나 저장해 두세요.
3. 만들어지면 **Project Settings → API Keys(또는 API)** 에서 두 값을 메모:
   - **Project URL** (예: `https://abcd1234.supabase.co`)
   - **anon public 키** 또는 **publishable 키** (`sb_publishable_...`)

### 2. 데이터베이스 설정
1. `supabase/schema.sql` 을 열어 **맨 아래 "1. 가족 명단"** 을 실제 가족 이메일과 이름으로 바꾸세요. (이메일은 소문자로)
2. 대시보드 **SQL Editor → New query** 에 전체를 붙여넣고 **Run**.
3. "Success" 가 나오면 완료. 여러 번 실행해도 안전해요.

### 3. `chat` 스키마를 API에 공개 (2단계 다음에!)
1. **Integrations → Data API → Settings 탭** (예전 화면은 Project Settings → API)
2. **Exposed schemas** 의 선택 상자를 눌러 **`chat` 에 체크** → 아래 **Save**
   - 2단계 SQL을 실행해야 목록에 `chat` 이 나타나요. 안 보이면 페이지를 새로고침하세요.
   - 기존 `public` 등은 체크를 풀지 마세요.
3. **Exposed tables** 에 `chat` 의 테이블들(messages, events 등)이 켜져 있는지 확인하세요.
4. **Harden Data API** 버튼은 누르지 마세요.

(이걸 빼먹으면 앱에서 "schema must be one of..." 오류가 나요.)

### 4. 가족 계정 만들기
1. **Authentication → Users → Add user → Create new user**
2. 가족 이메일과 임시 비밀번호(6자 이상) 입력, **Auto Confirm User** 체크 → 가족 수만큼 반복
   - 명단에 없는 이메일은 "Database error creating new user" 로 거부돼요. 정상이에요.
3. **Authentication → Sign In / Providers** 에서 **Allow new users to sign up** 을 **끄세요**.
   → 이제 외부인은 계정을 만들 수 없어요. 가족은 앱 메뉴(⋯)에서 비밀번호를 직접 바꿀 수 있어요.

### 5. 알림용 키 만들기
`tools/vapid-keys.html` 을 Chrome이나 Edge로 여세요(더블클릭). 값 3개가 나오면 **메모장에 저장**하세요.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_SECRET`

### 6. 푸시 알림 함수 만들기
1. **Edge Functions → Deploy a new function → Via Editor**
2. 이름을 정확히 **`send-push`** 로 하고, `supabase/functions/send-push/index.ts` 내용을 전부 붙여넣고 **Deploy**.
3. 함수 상세의 설정(Details)에서 **JWT 검증(Enforce/Verify JWT)** 을 **끄고** 저장하세요.
   (대신 `PUSH_SECRET` 으로 보호돼요.)
4. **Edge Functions → Secrets** 에 4개 추가:

   | 이름 | 값 |
   |---|---|
   | `VAPID_PUBLIC_KEY` | 5단계 공개 키 |
   | `VAPID_PRIVATE_KEY` | 5단계 비밀 키 |
   | `PUSH_SECRET` | 5단계 암호 |
   | `VAPID_SUBJECT` | `mailto:내이메일@gmail.com` |

5. **SQL Editor** 에서 아래를 내 값으로 바꿔 실행:
   ```sql
   insert into chat.app_config (key, value) values
     ('push_function_url', 'https://내프로젝트주소.supabase.co/functions/v1/send-push'),
     ('push_secret',       '5단계 PUSH_SECRET 값')
   on conflict (key) do update set value = excluded.value;
   ```

### 7. 앱 설정
`app/config.js` 를 열어 3개 값을 채우세요.
```js
SUPABASE_URL: "https://abcd1234.supabase.co",
SUPABASE_ANON_KEY: "1단계 anon/publishable 키",
VAPID_PUBLIC_KEY: "5단계 공개 키",
```
> anon/publishable 키와 VAPID 공개 키는 공개돼도 괜찮아요. **VAPID 비밀 키, PUSH_SECRET, service_role 키는 절대 config.js에 넣지 마세요.**

### 8. 웹에 올리기 (GitHub Pages, 무료)

**올릴 것은 `app` 폴더 안의 파일들뿐이에요.** `supabase` 폴더, `tools` 폴더, 이 README는 올리지 마세요
(가족 이메일과 설정 방법이 들어 있어요).

1. GitHub → 오른쪽 위 **+ → New repository**
   - Repository name: `family-chat` / **Public** / 나머지 옵션은 체크하지 않음 → **Create repository**
2. 새 저장소 화면의 **uploading an existing file** 링크(또는 Add file → Upload files)
3. `app` 폴더를 **열어서 안의 내용물을 전부 선택**해 끌어다 놓기
   (index.html, app.js, calendar.js, config.js, style.css, sw.js, manifest.webmanifest, icons 폴더)
   → 아래 **Commit changes**
4. 저장소 **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main** / **/(root)** → **Save**
5. 1~2분 뒤 Pages 화면 위쪽에 주소가 떠요: `https://내아이디.github.io/family-chat/`

> 수정 후 다시 올릴 때: 바뀐 파일만 다시 Upload files 로 올리면 덮어써져요. 이때 `sw.js` 맨 위
> `family-chat-v2` 의 숫자를 하나 올려서 같이 올려 주세요(v2 → v3). 그래야 기기들이 새 버전을 받아요.(기기들이 새 버전을 받도록).

---

## 기기별 설치와 알림 켜기

| 기기 | 설치 | 알림 |
|---|---|---|
| 노트북 (Windows/Mac) | Chrome·Edge로 접속 → 주소창 오른쪽 **설치 아이콘** | 앱 상단 🔔 누르고 허용 |
| 안드로이드 폰·갤럭시 탭 | Chrome·삼성 인터넷 → 메뉴 → **앱 설치 / 홈 화면에 추가** | 🔔 누르고 허용 |
| 아이패드 | **반드시 Safari** → 공유(□↑) → **홈 화면에 추가** | **홈 화면 아이콘으로 연 다음** 🔔 누르고 허용 (iPadOS 16.4 이상) |

- 알림은 **기기마다 한 번씩** 켜야 해요. 종 아이콘이 주황색이면 켜진 상태예요.
- PC에서는 Enter로 보내고 Shift+Enter로 줄바꿈, 휴대폰은 보내기 버튼을 눌러요.
- 사진은 📷 버튼 외에 PC에서는 **붙여넣기(Ctrl+V)** 나 **끌어다 놓기**도 돼요.
- 내 메시지는 **길게 누르기**(PC는 오른쪽 클릭)로 삭제할 수 있어요.

---

## 가족 달력 사용법

화면 위 **채팅 | 달력** 탭으로 오가요.

- **일정 추가**: 오른쪽 아래 **+ 일정 추가**, 또는 날짜를 고른 뒤 그 날짜를 한 번 더 누르기
- **수정·삭제**: 달력 아래 일정 목록에서 일정을 누르기 (가족 누구나 고칠 수 있어요)
- **누구 일정인지**: 가족 이름을 고르면 그 사람 색으로 표시돼요. 안 고르면 "가족 모두"(주황색)
- **반복**: 매주(학원), 매월, 매년(생일·기념일). 반복 일정은 한꺼번에 수정·삭제돼요
- **여러 날 일정**: "끝나는 날"을 바꾸면 여행처럼 며칠에 걸쳐 표시돼요
- **채팅방에 알리기**: 켜두면 채팅방에 일정 카드가 올라가고, 가족들에게 푸시 알림도 가요. 카드의 **달력에서 보기**를 누르면 그 날짜로 이동해요
- **오늘 일정**: 오늘 일정이 있으면 채팅 화면 맨 위에 표시돼요
- 휴대폰·태블릿에서는 달력을 옆으로 밀어 달을 넘길 수 있어요
- 양력 공휴일(신정, 삼일절, 어린이날 등)은 빨간색으로 표시돼요. **설날·추석 같은 음력 명절은 매년 날짜가 달라서 자동 표시되지 않으니** 일정으로 등록해 주세요

## 이모티콘

입력창 왼쪽 😊 버튼 → 이모티콘을 누르면 바로 보내져요.
이모티콘 파일은 앱(`stickers/` 폴더)과 함께 있고, 메시지에는 이름만 저장되므로 **Supabase 용량을 쓰지 않아요.**
각 기기는 이모티콘을 처음 한 번만 내려받아 저장해요.

**추가·변경할 때**: GIF를 움직이는 WebP(긴 변 320~400px)로 바꿔 `stickers/` 에 넣고,
`stickers.js` 목록에 한 줄 추가한 뒤 `STICKER_VERSION` 숫자를 올려서 GitHub에 올리면 돼요.

## 자주 겪는 문제

- **"config.js에 Supabase 주소와 키를 먼저 입력해 주세요"** → 7단계를 확인하고 다시 배포하세요.
- **"schema must be one of..." / 메시지가 안 불러와져요** → 2단계(Exposed schemas에 `chat`)를 확인하세요.
- **"가족 명단에 등록되지 않은 계정이에요"** → `chat.family_members` 에 그 이메일이 있는지 확인하세요.
- **알림이 안 와요**
  1. Edge Functions → `send-push` → **Logs** 에 오류가 있는지 확인 (403이면 PUSH_SECRET 불일치)
  2. 6-3단계 JWT 검증을 껐는지, 6-5단계 SQL을 실행했는지 확인
  3. 아이패드는 Safari가 아니라 **홈 화면 아이콘**으로 열었는지 확인
  4. 보낸 사람 본인에게는 알림이 가지 않아요(정상)
- **일주일 넘게 안 썼더니 안 돼요** → 무료 플랜 자동 일시정지예요. 대시보드에서 프로젝트를 열고 **Resume project** 를 누르면 데이터 그대로 돌아와요.

## 가족 추가하기
1. SQL Editor에서:
   ```sql
   insert into chat.family_members (email, display_name) values ('new@example.com', '할머니');
   ```
2. 4단계처럼 **Add user** 로 계정 만들기

## 나중에 다른 앱을 같은 프로젝트에 넣을 때
- 이 앱은 모든 테이블을 `chat` 스키마에 넣었어요. 새 앱은 `calendar`, `todo` 처럼 스키마를 따로 만들고 2단계처럼 Exposed schemas에 추가하면 서로 섞이지 않아요.
- 로그인 계정은 프로젝트 전체가 공유해요. 가족이 한 번만 계정을 만들면 모든 앱에 같은 이메일로 들어갈 수 있어요.
- 단, 이 앱이 추가한 "명단에 없는 이메일은 가입 거부" 규칙도 프로젝트 전체에 적용돼요. 가족 전용 프로젝트라면 그대로 두는 게 좋아요.

## 용량 참고 (무료 플랜)
- 데이터베이스 500MB: 텍스트 메시지는 수십만 개도 수십 MB 수준이에요.
- 파일 저장 1GB: 사진은 긴 변 1600px·JPEG 80%로 자동 압축돼 장당 약 200~400KB → 대략 3,000장 이상.
