// =========================================================
// spellcheck
// 채팅 입력창의 「맞춤법」 버튼이 부르는 서버 함수.
// 네이버 검색의 맞춤법 검사기에 글을 넣고, 고친 결과를 돌려줌.
// (브라우저에서 네이버로 바로 물어볼 수 없어서 이 함수가 대신 물어봄)
//
// 네이버가 공식으로 연 기능이 아니라서, 네이버 화면 구조가 바뀌면 멈출 수 있음.
// 그때는 { error } 로 "지금은 검사할 수 없어요" 가 앱에 뜨고 채팅은 그대로 동작.
//
// 보호: 로그인한 가족만 (요청의 로그인 토큰을 Supabase Auth 에 확인). 비밀 값 필요 없음.
// 요청: POST { text }  → 응답: { count, fixed, parts: [{ t, fix? }] }
// =========================================================

const MAX = 500; // 네이버 검사기 한 번 한도
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------- 네이버 검사기 열쇠(passportKey) ---------- */
// 네이버 검색 결과 화면 안에 들어 있는 값. 몇 시간마다 바뀌므로 기억해 두고, 거절되면 새로 받음.
let passportKey = "";
async function freshKey() {
  const url = "https://search.naver.com/search.naver?where=nexearch&query=" + encodeURIComponent("맞춤법검사기");
  const html = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  const m = html.match(/SpellerProxy\?passportKey=([0-9a-zA-Z]+)/) || html.match(/passportKey=([0-9a-zA-Z]+)/);
  if (!m) throw new Error("네이버 화면에서 검사기 열쇠를 찾지 못했어요");
  passportKey = m[1];
  return passportKey;
}

async function askNaver(text: string, key: string) {
  const u = new URL("https://ts-proxy.naver.com/ocontent/util/SpellerProxy");
  u.search = new URLSearchParams({ passportKey: key, _callback: "cb", q: text, where: "nexearch", color_blindness: "0" }).toString();
  const res = await fetch(u, { headers: { "User-Agent": UA, Referer: "https://search.naver.com/" } });
  const raw = await res.text();
  // 응답 모양: cb({...});
  const body = raw.slice(raw.indexOf("(") + 1, raw.lastIndexOf(")"));
  return JSON.parse(body)?.message ?? {};
}

/* ---------- 결과 정리 ---------- */
// 네이버 html: 고친 곳은 <em class='red_text'>…</em>, 줄바꿈은 <br>, 글자는 &lt; &quot; 등으로 바뀌어 옴.
// 앱이 innerHTML 을 쓰지 않도록 [{ t: 글자, fix: 고친 곳인지 }] 로 나눠서 돌려줌.
const unescape = (s: string) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function toParts(html: string) {
  const parts: { t: string; fix?: boolean }[] = [];
  const re = /<em[^>]*>([\s\S]*?)<\/em>/gi;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) parts.push({ t: unescape(html.slice(last, m.index)) });
    parts.push({ t: unescape(m[1]), fix: true });
    last = re.lastIndex;
  }
  if (last < html.length) parts.push({ t: unescape(html.slice(last)) });
  return parts.filter((p) => p.t);
}

/* ---------- 로그인 확인 ---------- */
async function loggedIn(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "POST 로 보내 주세요" }, 405);
  if (!(await loggedIn(req))) return json({ error: "로그인이 필요해요" }, 401);

  let text = "";
  try { text = String((await req.json())?.text ?? ""); } catch { /* 빈 글 */ }
  text = text.trim();
  if (!text) return json({ error: "검사할 글이 없어요" }, 400);
  if (text.length > MAX) return json({ error: `한 번에 ${MAX}자까지 검사할 수 있어요` }, 400);

  try {
    let msg = await askNaver(text, passportKey || (await freshKey()));
    if (msg.error) msg = await askNaver(text, await freshKey()); // 열쇠가 바뀐 경우 한 번 더
    const r = msg.result;
    if (!r || typeof r.html !== "string") throw new Error(msg.error || "네이버 응답 모양이 달라졌어요");
    const parts = toParts(r.html);
    return json({ count: Number(r.errata_count) || 0, fixed: parts.map((p) => p.t).join(""), parts });
  } catch (e) {
    console.error("spellcheck 실패:", e);
    return json({ error: "지금은 맞춤법 검사를 할 수 없어요", detail: String((e as Error)?.message ?? e) }, 502);
  }
});
