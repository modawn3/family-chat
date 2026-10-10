# 개인 달력을 가족 앱으로 옮기기 (한 번만 하는 작업)

예전 「나의 달력 메모장」(Supabase 프로젝트 `personal memo calendar`, 사이트 `modawn3.github.io/calendar`)을
가족 앱(Supabase 프로젝트 `family`, 사이트 `modawn3.github.io/family-chat`)으로 합치는 순서입니다.
끝나면 Supabase 프로젝트도 1개, GitHub Pages 사이트도 1개만 쓰게 돼요.

- 새 개인 달력 주소: **https://modawn3.github.io/family-chat/my/** (가족 앱의 「내 달력」 탭)
- 로그인: 가족 채팅 계정 그대로 (한 번 로그인하면 두 화면 모두 로그인됨)
- 내 일정·메모는 지금처럼 **나만** 볼 수 있어요. 공휴일·날씨는 가족 달력에서도 같이 써요.

SQL 을 붙여넣을 때는 이 안내서의 ``` 줄은 빼고 복사하세요.
순서대로 하면 중간에 멈춰도 예전 달력은 그대로 동작해요(예전 프로젝트는 마지막 단계 전까지 건드리지 않아요).

---

## 1단계. 가족 프로젝트에 테이블 만들기

1. Supabase 대시보드에서 **family** 프로젝트 → 왼쪽 **SQL Editor** → **New query**
2. `supabase/migrations/004_my_calendar.sql` 내용을 전부 붙여넣고 **Run**
3. 맨 아래 결과에 `테이블` 4줄(events, holidays, memos, weather)과 `예약` 2줄이 보이면 성공

## 2단계. 공휴일·날씨 함수 옮기기

1. family 프로젝트 → **Edge Functions** → **Deploy a new function** → **Via Editor**
   - 이름 `sync-holidays`, 코드는 `supabase/functions/sync-holidays/index.ts` 를 붙여넣고 **Deploy**
   - 같은 방법으로 `sync-weather` (코드는 `supabase/functions/sync-weather/index.ts`)
   - 두 함수 모두 JWT 검증(**Verify JWT**) 옵션을 **끄기** (예전 프로젝트와 같은 설정, 대신 CRON_SECRET 으로 보호)
2. Edge Functions → **Secrets** 에 두 개 추가
   - `HOLIDAY_API_KEY` : 공공데이터포털 → 마이페이지 → 활용신청 현황 → 일반 인증키(**Decoding**). 예전 프로젝트와 같은 값
   - `CRON_SECRET` : 새로 만든 긴 암호 (예: 영문+숫자 32자). 아래 3단계에서 한 번 더 써요
3. 위 `CRON_SECRET` 값을 DB 에도 넣고, 바로 한 번 실행해 보기 (SQL Editor, `여기에_암호` 를 바꿔서):

```sql
insert into chat.app_config (key, value) values ('cron_secret', '여기에_암호')
on conflict (key) do update set value = excluded.value;
select chat.call_cron_function('sync-holidays');
select chat.call_cron_function('sync-weather');
```

4. 20초쯤 뒤에 확인:

```sql
select status_code, left(content::text, 120) as 결과, created
from net._http_response order by created desc limit 2;
```

`200` 이 두 줄 보이면 성공이에요. `403` 이면 Secrets 의 `CRON_SECRET` 과 DB 에 넣은 값이 다른 것,
`500` 이면 `HOLIDAY_API_KEY` 문제예요.

## 3단계. 일정·메모 옮기기

1. **예전** 프로젝트(personal memo calendar) → SQL Editor 에서 `supabase/move-calendar/1_export_from_old.sql` 실행
   → 결과의 `내보내기` 칸을 눌러 내용을 통째로 복사 (읽기만 하는 SQL 이라 예전 자료는 그대로예요)
2. **family** 프로젝트 → SQL Editor 에 `supabase/move-calendar/2_import_to_family.sql` 붙여넣기
   - `여기에_붙여넣기` 글자를 지우고 그 자리에 방금 복사한 내용 붙여넣기 (`$내보내기_7f3k$` 표시는 그대로)
   - 예전 달력 로그인 이메일이 가족 채팅 이메일과 다르면 `바꿀_이메일` 칸에 가족 채팅 이메일 적기
3. **Run** → `새로_넣은_일정`, `새로_넣은_메모` 숫자가 예전 개수와 같고 `계정을_못_찾은_이메일` 이 비어 있으면 성공
   (여러 번 실행해도 두 번 들어가지 않아요)

## 4단계. 새 주소에서 확인

1. 가족 앱을 완전히 닫았다 다시 열기 → 위쪽에 「채팅 · 가족 달력 · 내 달력」 탭이 보여요
2. 「내 달력」 → 예전 일정·메모, 날씨, 공휴일이 보이면 성공
3. PC 에서는 https://modawn3.github.io/family-chat/my/ 를 즐겨찾기하거나 홈 화면 앱으로 설치해도 돼요

## 5단계. 위젯 주소 바꾸기 (안드로이드·바탕화면·아이패드)

위젯들은 같은 이름의 테이블을 쓰므로 **Supabase 주소와 공개 키 두 줄만** 바꾸면 돼요. 새 값은 `config.js` 에 있는
`SUPABASE_URL`, `SUPABASE_ANON_KEY` 입니다. 바꾼 뒤에는 위젯에서 **가족 채팅 계정으로 다시 로그인**해야 해요.

| 위젯 | 바꿀 곳 (컴퓨터의 my-calendar 폴더) | 적용 방법 |
|---|---|---|
| 바탕화면 | `desktop-widget/app/widget.html` 의 `SUPABASE_URL`, `SUPABASE_KEY` | `npm run update-file` → `update-CalendarWidget.bat` |
| 안드로이드 | `android/src/com/mycalendar/app/Store.java` 의 주소·키, `android/assets/www/index.html` 의 주소·키 | APK 다시 빌드(같은 서명 열쇠, versionCode 올리기) 후 설치 |
| 아이패드 | `ipad/나의달력위젯.js` 위쪽 `SUPABASE_URL`, `SUPABASE_KEY` | Scriptable 에 코드 다시 붙여넣기 |

안드로이드 앱 안의 화면도 새 주소(`https://modawn3.github.io/family-chat/my/`)를 직접 띄우게 바꾸면,
앞으로는 화면을 고칠 때 APK 를 다시 만들 필요가 없어져요.

## 6단계. 정리 (며칠 써 보고 문제없을 때)

1. 예전 사이트 `modawn3.github.io/calendar` 를 새 주소로 자동 이동하게 바꾸기 (위젯이 예전 주소를 열어도 새 주소로 감)
2. 예전 프로젝트의 예약 끄기 (예전 프로젝트 SQL Editor):
   `select cron.unschedule(jobid) from cron.job where jobname in ('sync-holidays-daily', 'sync-weather');`
3. 예전 Supabase 프로젝트 **Pause** (일주일 더 지켜본 뒤 필요 없으면 삭제)
4. GitHub `modawn3/calendar` 저장소는 보관(Archive)하거나 삭제

이 단계들은 되돌리기 어려우니 하나씩 확인하면서 해 주세요.
