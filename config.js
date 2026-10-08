// ★ 여기 값만 채우면 됩니다. 이 파일은 GitHub에 공개돼요.
//
// ✅ 넣어도 되는 것 (원래 공개용):  Project URL, anon/publishable 키, VAPID 공개 키(87자)
// ❌ 절대 넣으면 안 되는 것:        service_role 키, secret 키(sb_secret_...), VAPID 비밀 키(43자),
//                                   PUSH_SECRET, DB 비밀번호
// (실수로 넣으면 앱이 경고를 띄우고 동작을 멈춰요)
export const CONFIG = {
  // Supabase 대시보드 → Project Settings → API Keys (또는 Connect 버튼)
  SUPABASE_URL: "https://qgotxqbmcxulneqdjvav.supabase.co",

  // "anon public" 키(eyJ...로 시작) 또는 "publishable" 키(sb_publishable_...로 시작)
  SUPABASE_ANON_KEY: "sb_publishable_wENcAOvX0qM99J4C4zoCPw_A0gGPKiS",

  // tools/vapid-keys.html 에서 만든 VAPID_PUBLIC_KEY (87자). 비워두면 알림 버튼이 숨겨져요.
  VAPID_PUBLIC_KEY: "BHL63BkEKFVuxBo6QRIv9848nRKRIuqmtYx0CR0D5T7bk26cAtyC0tC-zJeqPJCNM0CmCsgxVqb_pgy_Loqdr8s
",

  // 채팅방 이름
  APP_NAME: "우리 가족",
};
