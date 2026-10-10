// 새 메시지가 오면 보낸 사람을 제외한 가족의 모든 기기에 푸시 알림을 보냅니다.
// Supabase 대시보드 → Edge Functions 에서 이름을 "send-push" 로 만들고 이 코드를 붙여넣으세요.
// 필요한 Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SECRET
// (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어줘요)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// 값에 섞인 공백·줄바꿈·따옴표를 정리해서 읽기 (복사·붙여넣기 실수 방지)
const readKey = (name: string) => (Deno.env.get(name) ?? "").replace(/[\s"']/g, "");
const PUSH_SECRET = readKey("PUSH_SECRET");
const VAPID_PUBLIC_KEY = readKey("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = readKey("VAPID_PRIVATE_KEY");
let VAPID_SUBJECT = (Deno.env.get("VAPID_SUBJECT") ?? "").trim().replace(/^["']|["']$/g, "");
if (VAPID_SUBJECT && !/^(mailto:|https:\/\/)/.test(VAPID_SUBJECT)) {
  VAPID_SUBJECT = VAPID_SUBJECT.includes("@") ? `mailto:${VAPID_SUBJECT}` : "";
}

// 설정 문제를 사람이 읽을 수 있는 문장으로 (비밀값 자체는 절대 출력하지 않음)
function configProblem(): string | null {
  const problems: string[] = [];
  if (!PUSH_SECRET) problems.push("Secrets에 PUSH_SECRET 이 없어요");
  if (!VAPID_PUBLIC_KEY) problems.push("Secrets에 VAPID_PUBLIC_KEY 가 없어요");
  else if (!/^[A-Za-z0-9_-]{87}$/.test(VAPID_PUBLIC_KEY)) {
    problems.push(`VAPID_PUBLIC_KEY 는 87자여야 하는데 ${VAPID_PUBLIC_KEY.length}자예요`);
  }
  if (!VAPID_PRIVATE_KEY) problems.push("Secrets에 VAPID_PRIVATE_KEY 가 없어요");
  else if (!/^[A-Za-z0-9_-]{43}$/.test(VAPID_PRIVATE_KEY)) {
    problems.push(`VAPID_PRIVATE_KEY 는 43자여야 하는데 ${VAPID_PRIVATE_KEY.length}자예요`);
  }
  if (!VAPID_SUBJECT) problems.push("VAPID_SUBJECT 는 mailto:이메일 형식이어야 해요");
  if (problems.length) return problems.join(" / ");
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (e) {
    return `VAPID 설정 오류: ${(e as Error).message}`;
  }
  return null;
}
const CONFIG_PROBLEM = configProblem();
if (CONFIG_PROBLEM) console.error("[send-push] 설정 문제:", CONFIG_PROBLEM);

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { db: { schema: "chat" }, auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  // 브라우저로 함수 주소를 열면 설정 상태만 알려줌 (비밀값은 안 보여줌)
  if (req.method === "GET") {
    return Response.json({ ok: !CONFIG_PROBLEM, problem: CONFIG_PROBLEM });
  }
  if (!PUSH_SECRET || req.headers.get("x-push-secret") !== PUSH_SECRET) {
    return Response.json({ error: "PUSH_SECRET 불일치 (Secrets 값과 SQL app_config 값이 같은지 확인)" }, { status: 403 });
  }
  if (CONFIG_PROBLEM) {
    return Response.json({ error: CONFIG_PROBLEM }, { status: 500 });
  }

  try {
    const messageId = (await req.json()).message_id;

    const { data: msg, error } = await db
      .from("messages")
      .select("id, user_id, content, image_path")
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw new Error(`메시지 조회 실패: ${error.message}`);
    if (!msg) return Response.json({ error: "message not found" }, { status: 404 });

    const { data: sender } = await db
      .from("family_members")
      .select("display_name")
      .eq("user_id", msg.user_id)
      .maybeSingle();

    const { data: subs, error: subErr } = await db
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .neq("user_id", msg.user_id);
    if (subErr) throw new Error(`구독 조회 실패: ${subErr.message}`);
    if (!subs?.length) return Response.json({ sent: 0, note: "보낸 사람 외에 알림 등록된 기기가 없어요" });

    const text = (msg.content ?? "").trim();
    const payload = JSON.stringify({
      title: sender?.display_name ?? "가족",
      body: text ? (text.length > 120 ? text.slice(0, 120) + "…" : text) : "📷 사진을 보냈어요",
      tag: "family-chat",
      url: "./",
    });

    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high" },
        )
      ),
    );

    // 만료되거나 해지된 구독은 정리
    const dead: string[] = [];
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const err = r.reason as { statusCode?: number; body?: string; message?: string };
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(subs[i].endpoint);
        else failures.push(`${new URL(subs[i].endpoint).host} ${err?.statusCode ?? ""} ${err?.body ?? err?.message ?? ""}`.trim());
      }
    });
    if (dead.length) await db.from("push_subscriptions").delete().in("endpoint", dead);
    if (failures.length) console.error("[send-push] 발송 실패:", failures);

    return Response.json({
      sent: results.filter((r) => r.status === "fulfilled").length,
      removed: dead.length,
      failed: failures.map((f) => f.slice(0, 120)),
    });
  } catch (e) {
    console.error("[send-push] 오류:", e);
    return Response.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
});
