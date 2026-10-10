# 지금까지의 결정과 이유 (2026-10-07 ~ 10-10)

claude.ai 대화에서 함께 만든 과정을 정리한 기록입니다. 새로 작업할 때 "왜 이렇게 되어 있지?" 싶으면 여기를 보세요.

## 1. 플랫폼: PWA를 고른 이유
- 목표: 노트북 여러 대, 안드로이드 폰 2대, 갤럭시 탭, 아이패드에서 모두 사용.
- Flutter / React Native는 아이폰·아이패드에 설치하려면 애플 개발자 계정(연 $99) + TestFlight가 필요 → 가족용으로 과함.
- PWA는 계정·스토어 없이 모든 기기에서 "홈 화면에 추가"로 앱처럼 쓰고 알림도 받을 수 있음(iPadOS 16.4+).

## 2. 백엔드: Supabase
- 사용자가 써 본 경험이 있어 Firebase 대신 선택.
- Firebase는 2026-02-03부터 Cloud Storage가 무료(Spark) 플랜에서 빠져 사진 기능에 결제 카드 등록이 필요해짐.
- Supabase 무료 플랜 주의점: 7일 미사용 시 일시정지(1년 안에 복구 가능), 조직당 무료 프로젝트 2개.
- 기존 개인 달력 앱 프로젝트와 분리해 **두 번째 프로젝트**로 생성. 테이블은 전부 `chat` 스키마에 넣어 나중에 합치기 쉽게 함.
- 푸시는 Supabase에 내장 기능이 없어 표준 Web Push(VAPID) + Edge Function + DB 트리거(pg_net)로 구현.

## 3. 호스팅: GitHub Pages
- USB 복사는 불가: PWA·서비스 워커·알림·ES 모듈은 https 주소에서만 동작, 아이패드는 로컬 HTML을 못 엶.
- Netlify 무료는 크레딧제(월 300, 배포 1회 15크레딧 → 약 20회)이고 초과 시 사이트 정지 → 자주 고칠 예정이라 제외.
- GitHub Pages는 무료 계정이면 Public 저장소 필요 → 앱 파일만 올리고 가족 이메일이 든 파일은 올리지 않기로 함.
- 검색엔진 노출 방지: `<meta name="robots" content="noindex">`.

## 4. 기능 추가 순서
1. 채팅 기본: 로그인(이메일/비밀번호, 가입 꺼둠), 실시간 메시지, 사진(긴 변 1600px JPEG 압축), 읽음 표시, 내 메시지 삭제, 다크 모드
2. 가족 달력: 채팅|달력 탭, 반복 일정, 가족별 색상, 일정 등록 시 채팅방에 카드 + 푸시, 오늘 일정 띠
3. 안전장치: config.js에 비밀 키가 들어가면 앱이 멈추고 경고
4. 푸시 함수 개선: Secrets 값의 공백·줄바꿈·`mailto:` 누락을 자동 보정, 문제를 문장으로 알려줌
5. 전송량 절감: 채팅엔 미리보기 사진(긴 변 520px), 사진·이모티콘은 서비스 워커가 기기에 저장(토큰 떼고 경로로 캐시)
6. 이모티콘: 상어 9개 + 고양이 3개. GIF 15MB+4MB → WebP 3.2MB. 메시지엔 id만 저장해 Supabase 용량 0

## 5. 설치하면서 겪은 문제와 해결
| 증상 | 원인 | 해결 |
|---|---|---|
| Exposed schemas에 chat 추가 불가 | 스키마가 아직 없었음(목록에서 고르는 방식) | SQL 먼저 실행 후 선택 |
| SQL `syntax error at or near "on"` | 가족 명단 마지막 줄 뒤 쉼표 | 쉼표 제거 |
| SQL `syntax error at or near "```"` | 안내서의 ``` 줄까지 복사 | 그 줄 빼고 실행 |
| 앱이 하얀 화면 | config.js의 VAPID 키 중간에 줄바꿈 | 한 줄로 수정 |
| 회사 PC Chrome 알림 등록 실패 | 회사망이 구글 푸시 서버 차단 | Edge 사용 |
| 알림이 아무에게도 안 옴 (500 WORKER_ERROR) | 함수 시작 시 VAPID 설정 검사에서 예외 | 함수 개선판 배포 |
| 한 폰에서만 고양이 이모티콘 안 보임 | 예전 stickers.js 캐시 | 앱 완전 종료 후 재실행 |

## 6. 진단에 유용했던 SQL
```sql
select '1. 알림 등록 기기' as 항목,
       coalesce(m.display_name, '?') || ' / ' || left(coalesce(s.user_agent, ''), 60) as 내용
from chat.push_subscriptions s
left join chat.family_members m on m.user_id = s.user_id
union all
select '2. 설정값',
       key || ' = ' || case when key = 'push_secret' then '(길이 ' || length(value) || ')' else value end
from chat.app_config
union all
select '3. 최근 함수 호출',
       to_char(r.created at time zone 'Asia/Seoul', 'HH24:MI') || ' / 상태 ' || coalesce(r.status_code::text, '없음')
       || ' / ' || left(coalesce(r.content::text, r.error_msg, ''), 150)
from (select * from net._http_response order by created desc limit 5) r
order by 1;
```
상태 401=함수 JWT 검증 켜짐, 403=PUSH_SECRET 불일치, 404=함수 이름/주소, 500=VAPID Secrets 문제, 200 `"sent":0`=받을 기기 없음.
