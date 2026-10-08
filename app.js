import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js";
import { createCalendar, announceText, whenText, todayStr, timeText } from "./calendar.js";
import { STICKERS, STICKER_VERSION } from "./stickers.js";

const stickerById = new Map(STICKERS.map((s) => [s.id, s]));
const stickerUrl = (s) => `stickers/${s.id}.webp?v=${STICKER_VERSION}`;

// ---------------------------------------------------------------------
// 기본 설정
// ---------------------------------------------------------------------
const $ = (sel, el = document) => el.querySelector(sel);
const PAGE = 50;
const BUCKET = "chat-images";
const MAX_IMAGE_SIDE = 1600;
const IMAGE_QUALITY = 0.8;
const THUMB_SIDE = 520;       // 채팅 화면용 미리보기 (보통 30~60KB)
const THUMB_QUALITY = 0.72;
const IMAGE_CACHE = "family-chat-images"; // sw.js 와 같은 이름
let thumbColumnMissing = false;           // DB에 thumb_path 컬럼이 아직 없을 때
const URL_TTL = 60 * 60 * 24 * 7;

const isTouch = matchMedia("(pointer: coarse)").matches;
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const configured = /^https:\/\/.+/.test(CONFIG.SUPABASE_URL) &&
  !CONFIG.SUPABASE_URL.includes("YOUR-PROJECT") &&
  CONFIG.SUPABASE_ANON_KEY && !CONFIG.SUPABASE_ANON_KEY.includes("YOUR-");

// 공개 사이트에 올리면 안 되는 비밀 키가 config.js 에 들어갔는지 검사
function secretKeyProblem() {
  const k = String(CONFIG.SUPABASE_ANON_KEY || "");
  if (k.startsWith("sb_secret_")) return "Supabase 비밀 키(sb_secret_…)";
  const parts = k.split(".");
  if (parts.length === 3) {
    try {
      const role = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
      if (role === "service_role") return "Supabase service_role 키";
    } catch { /* 무시 */ }
  }
  const v = String(CONFIG.VAPID_PUBLIC_KEY || "");
  if (/^[A-Za-z0-9_-]{43}$/.test(v)) return "알림 비밀 키(VAPID_PRIVATE_KEY)"; // 공개 키는 87자, 비밀 키는 43자
  return "";
}
const keyProblem = secretKeyProblem();

const fmtDay = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
const fmtTime = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });

const el = {
  login: $("#login"), loginForm: $("#login-form"), loginError: $("#login-error"),
  chat: $("#chat"), list: $("#messages"), input: $("#input"), send: $("#btn-send"),
  file: $("#file"), composer: $("#composer"), newPill: $("#new-pill"),
  bell: $("#btn-bell"), menuBtn: $("#btn-menu"), menu: $("#menu"),
  banner: $("#install-banner"), lightbox: $("#lightbox"), toast: $("#toast"),
  tabs: document.querySelectorAll(".tabs [data-tab]"), paneChat: $("#pane-chat"), paneCal: $("#pane-cal"),
  chatDot: $("#chat-dot"), todayStrip: $("#today-strip"),
  stickerBtn: $("#btn-sticker"), stickerPanel: $("#sticker-panel"),
};

const state = {
  me: null,
  tab: "chat",
  memberNames: [],      // 가족 명단 순서대로 이름 (달력 색상/참여자)
  members: new Map(),   // user_id -> { name }
  reads: new Map(),     // user_id -> Date
  messages: [],         // id 오름차순
  byId: new Map(),
  urls: new Map(),      // image_path -> signed url
  hasMore: true,
  loadingOlder: false,
  channel: null,
};

let sb = null;
let cal = null;

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
document.title = CONFIG.APP_NAME;
$("#login-title").textContent = CONFIG.APP_NAME;
$("#chat-title").textContent = CONFIG.APP_NAME;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW 등록 실패", e));
}
fitViewportForIOS();

if (keyProblem) {
  showLogin(`⚠️ config.js 에 ${keyProblem}가 들어 있어요. 공개되면 안 되는 키예요. ` +
    "공개용 키로 바꿔 다시 올리고, Supabase에서 그 비밀 키를 새로 발급(교체)해 주세요.");
} else if (!configured) {
  showLogin("config.js 에 Supabase 주소와 키를 먼저 입력해 주세요.");
} else {
  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    db: { schema: "chat" },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") { stopChat(); showLogin(); }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (session) startChat(session.user);
  else showLogin();
}

// ---------------------------------------------------------------------
// 로그인
// ---------------------------------------------------------------------
function showLogin(message) {
  el.chat.hidden = true;
  el.login.hidden = false;
  setLoginError(message);
}

function setLoginError(message) {
  el.loginError.textContent = message || "";
  el.loginError.hidden = !message;
}

el.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sb) return;
  const form = new FormData(el.loginForm);
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  if (!email || !password) return setLoginError("이메일과 비밀번호를 입력해 주세요.");

  const btn = el.loginForm.querySelector("button");
  btn.disabled = true;
  setLoginError("");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) {
    setLoginError(/invalid login/i.test(error.message)
      ? "이메일 또는 비밀번호가 맞지 않아요."
      : `로그인하지 못했어요: ${error.message}`);
    return;
  }
  el.loginForm.reset();
  startChat(data.user);
});

// ---------------------------------------------------------------------
// 채팅 시작/종료
// ---------------------------------------------------------------------
async function startChat(user) {
  state.me = user;
  el.login.hidden = true;
  el.chat.hidden = false;
  el.list.innerHTML = "";

  try {
    await loadMembers();
    if (!state.members.has(user.id)) {
      toast("가족 명단에 등록되지 않은 계정이에요.");
      await sb.auth.signOut();
      return;
    }
    await loadReads();
    cal ??= createCalendar({
      sb,
      getMemberNames: () => state.memberNames,
      onAnnounce: announceEvent,
      onChange: eventsChanged,
      toast,
    });
    await cal.start();
    updateTodayStrip();
    await loadLatest();
    switchTab(savedTab());
    subscribe();
    markReadSoon();
    showInstallHint();
    await refreshBell();
    resyncPushSubscription();
  } catch (e) {
    console.error(e);
    toast(`불러오지 못했어요: ${e.message || e}`);
  }
}

function stopChat() {
  if (state.channel) sb.removeChannel(state.channel);
  cal?.stop();
  Object.assign(state, {
    me: null, channel: null, messages: [], hasMore: true, loadingOlder: false,
  });
  state.byId.clear(); state.members.clear(); state.reads.clear(); state.urls.clear();
  el.list.innerHTML = "";
  el.menu.hidden = true;
}

async function loadMembers() {
  const { data, error } = await sb.from("family_members").select("user_id, display_name").order("created_at");
  if (error) throw error;
  state.members.clear();
  for (const m of data) if (m.user_id) state.members.set(m.user_id, { name: m.display_name });
  state.memberNames = data.map((m) => m.display_name);
  $("#chat-members").textContent = data.map((m) => m.display_name).join(", ");
}

async function loadReads() {
  const { data, error } = await sb.from("read_status").select("user_id, last_read_at");
  if (error) throw error;
  for (const r of data) state.reads.set(r.user_id, new Date(r.last_read_at));
}

// ---------------------------------------------------------------------
// 메시지 불러오기
// ---------------------------------------------------------------------
async function loadLatest() {
  const { data, error } = await sb.from("messages").select("*").order("id", { ascending: false }).limit(PAGE);
  if (error) throw error;
  const rows = data.reverse();
  state.hasMore = rows.length === PAGE;
  state.messages = rows;
  state.byId = new Map(rows.map((m) => [m.id, m]));
  await prefetchUrls(rows);
  renderAll();
  scrollToBottom();
}

async function loadOlder() {
  if (!state.hasMore || state.loadingOlder || !state.messages.length) return;
  state.loadingOlder = true;
  try {
    const firstId = state.messages[0].id;
    const { data, error } = await sb.from("messages").select("*")
      .lt("id", firstId).order("id", { ascending: false }).limit(PAGE);
    if (error) throw error;
    const rows = data.reverse().filter((m) => !state.byId.has(m.id));
    state.hasMore = data.length === PAGE;
    await prefetchUrls(rows);
    rows.forEach((m) => state.byId.set(m.id, m));
    state.messages = rows.concat(state.messages);

    const prevHeight = el.list.scrollHeight;
    const prevTop = el.list.scrollTop;
    renderAll();
    el.list.scrollTop = el.list.scrollHeight - prevHeight + prevTop;
  } catch (e) {
    toast(`이전 메시지를 불러오지 못했어요: ${e.message}`);
  } finally {
    state.loadingOlder = false;
  }
}

async function syncNewer() {
  if (!state.me) return;
  const lastId = state.messages.at(-1)?.id ?? 0;
  const { data, error } = await sb.from("messages").select("*").gt("id", lastId).order("id").limit(200);
  if (!error && data.length) await addMessages(data);
  loadReads().then(updateUnreadCounts).catch(() => {});
}

async function prefetchUrls(rows) {
  // 채팅에는 미리보기(thumb_path)만 받고, 큰 사진은 눌렀을 때 받아요
  const paths = [...new Set(rows.map((m) => m.thumb_path || m.image_path).filter((p) => p && !state.urls.has(p)))];
  if (!paths.length) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, URL_TTL);
  if (error) { console.warn(error); return; }
  for (const item of data) if (item.signedUrl) state.urls.set(item.path, item.signedUrl);
}

// ---------------------------------------------------------------------
// 실시간
// ---------------------------------------------------------------------
function subscribe() {
  if (state.channel) sb.removeChannel(state.channel);
  state.channel = sb.channel("family-chat")
    .on("postgres_changes", { event: "INSERT", schema: "chat", table: "messages" },
      (p) => addMessages([p.new]))
    .on("postgres_changes", { event: "DELETE", schema: "chat", table: "messages" },
      (p) => removeMessage(p.old.id))
    .on("postgres_changes", { event: "*", schema: "chat", table: "read_status" },
      (p) => {
        if (!p.new?.user_id) return;
        state.reads.set(p.new.user_id, new Date(p.new.last_read_at));
        updateUnreadCounts();
      })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") syncNewer(); // 연결이 끊겼던 동안 온 메시지 채우기
    });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.me) {
    syncNewer();
    markReadSoon();
    cal?.render();        // 자정이 지났으면 '오늘' 표시 갱신
    updateTodayStrip();
  }
});
window.addEventListener("online", () => state.me && syncNewer());
window.addEventListener("focus", () => state.me && markReadSoon());

// ---------------------------------------------------------------------
// 메시지 추가/삭제/그리기
// ---------------------------------------------------------------------
async function addMessages(rows) {
  const fresh = rows.filter((m) => !state.byId.has(m.id));
  if (!fresh.length) return;
  await prefetchUrls(fresh);
  // prefetch 중 다른 경로로 이미 들어왔을 수 있으니 다시 확인
  const toAdd = fresh.filter((m) => !state.byId.has(m.id)).sort((a, b) => a.id - b.id);
  if (!toAdd.length) return;

  const nearBottom = isNearBottom();
  const lastId = state.messages.at(-1)?.id ?? 0;
  toAdd.forEach((m) => state.byId.set(m.id, m));

  if (toAdd[0].id > lastId) {
    for (const m of toAdd) {
      const prev = state.messages.at(-1);
      state.messages.push(m);
      appendMessage(m, prev);
    }
    $(".empty", el.list)?.remove();
    updateUnreadCounts();
  } else {
    state.messages = [...state.byId.values()].sort((a, b) => a.id - b.id);
    renderAll();
  }

  const mineLast = toAdd.at(-1).user_id === state.me.id;
  if (nearBottom || mineLast) scrollToBottom();
  else el.newPill.hidden = false;
  if (state.tab !== "chat" && toAdd.some((m) => m.user_id !== state.me.id)) el.chatDot.hidden = false;
  markReadSoon();
}

function removeMessage(id) {
  const m = state.byId.get(id);
  if (!m) return;
  evictCachedImages(m);
  state.byId.delete(id);
  state.messages = state.messages.filter((m) => m.id !== id);
  const top = el.list.scrollTop;
  renderAll();
  el.list.scrollTop = top;
}

function renderAll() {
  el.list.innerHTML = "";
  if (state.hasMore && state.messages.length) {
    const older = document.createElement("div");
    older.className = "older";
    older.textContent = "위로 올리면 이전 메시지를 불러와요";
    el.list.append(older);
  }
  if (!state.messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "첫 메시지를 보내 보세요 👋";
    el.list.append(empty);
    return;
  }
  state.messages.forEach((m, i) => appendMessage(m, state.messages[i - 1]));
  updateUnreadCounts();
}

function dayKey(m) {
  const d = new Date(m.created_at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function appendMessage(m, prev) {
  const newDay = !prev || dayKey(prev) !== dayKey(m);
  if (newDay) {
    const day = document.createElement("div");
    day.className = "day";
    day.textContent = fmtDay.format(new Date(m.created_at));
    el.list.append(day);
  }

  const mine = m.user_id === state.me.id;
  const gap = prev ? new Date(m.created_at) - new Date(prev.created_at) : Infinity;
  const first = newDay || !prev || prev.user_id !== m.user_id || gap > 5 * 60 * 1000;

  const wrap = document.createElement("div");
  wrap.className = `msg ${mine ? "mine" : "theirs"}${first ? " first" : ""}`;
  wrap.dataset.id = m.id;

  if (!mine && first) {
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = state.members.get(m.user_id)?.name ?? "알 수 없음";
    wrap.append(who);
  }

  const row = document.createElement("div");
  row.className = "row";

  // 일정 메시지는 카드로, 일정이 삭제됐으면 보통 글자로 표시
  const card = (m.event_id ? renderEventCard(m) : null) || renderSticker(m);
  const bubble = card || document.createElement("div");
  if (!card) bubble.className = "bubble";
  if (!card && m.image_path) {
    bubble.classList.add("has-img");
    const img = document.createElement("img");
    img.alt = "사진";
    img.loading = "lazy";
    img.decoding = "async";
    if (m.image_width && m.image_height) img.style.aspectRatio = `${m.image_width} / ${m.image_height}`;
    img.crossOrigin = "anonymous"; // 기기 저장(서비스 워커 캐시)이 되도록
    const url = state.urls.get(m.thumb_path || m.image_path);
    if (url) img.src = url;
    img.addEventListener("load", () => { if (isNearBottom(300)) el.list.scrollTop = el.list.scrollHeight; }, { once: true });
    img.addEventListener("click", () => openPhoto(m, img.src));
    bubble.append(img);
  }
  if (m.content && !card) {
    const text = document.createElement("div");
    text.className = "text";
    linkify(text, m.content);
    bubble.append(text);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const unread = document.createElement("span");
  unread.className = "unread";
  const time = document.createElement("time");
  time.dateTime = m.created_at;
  time.textContent = fmtTime.format(new Date(m.created_at));
  meta.append(unread, time);

  row.append(bubble, meta);
  wrap.append(row);
  if (mine) attachDeleteGesture(bubble, m);
  el.list.append(wrap);
}

function linkify(container, text) {
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match.index > last) container.append(text.slice(last, match.index));
    const a = document.createElement("a");
    a.href = match[0];
    a.textContent = match[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    container.append(a);
    last = match.index + match[0].length;
  }
  if (last < text.length) container.append(text.slice(last));
}

// ---------------------------------------------------------------------
// 달력 연결: 탭, 일정 카드, 오늘 일정
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 이모티콘: 파일은 앱과 함께 있고, 메시지에는 이름(sticker)만 저장 → Supabase 용량을 쓰지 않음
// ---------------------------------------------------------------------
function renderSticker(m) {
  if (m.kind !== "sticker") return null;
  const s = stickerById.get(m.sticker);
  if (!s) return null; // 지워진 이모티콘이면 "(이모티콘) 이름" 글자로 표시
  const wrap = document.createElement("div");
  wrap.className = "bubble sticker-msg";
  const img = document.createElement("img");
  img.src = stickerUrl(s);
  img.alt = s.label;
  img.title = s.label;
  img.decoding = "async";
  img.style.width = `${s.w / 2}px`;
  img.style.aspectRatio = `${s.w} / ${s.h}`;
  img.addEventListener("load", () => { if (isNearBottom(300)) el.list.scrollTop = el.list.scrollHeight; }, { once: true });
  wrap.append(img);
  return wrap;
}

function buildStickerPanel() {
  el.stickerPanel.replaceChildren(...STICKERS.map((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sticker-pick";
    b.setAttribute("role", "option");
    b.setAttribute("aria-label", s.label);
    b.title = s.label;
    const img = document.createElement("img");
    img.src = stickerUrl(s);
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    b.append(img);
    b.addEventListener("click", () => sendSticker(s));
    return b;
  }));
}

function toggleStickerPanel(open = el.stickerPanel.hidden) {
  if (open && !el.stickerPanel.childElementCount) buildStickerPanel();
  const nearBottom = isNearBottom();
  el.stickerPanel.hidden = !open;
  el.stickerBtn.setAttribute("aria-expanded", String(open));
  if (open && isTouch) el.input.blur(); // 휴대폰: 키보드 대신 이모티콘 창
  if (nearBottom) el.list.scrollTop = el.list.scrollHeight;
}
el.stickerBtn.addEventListener("click", () => toggleStickerPanel());
el.input.addEventListener("focus", () => { if (isTouch && !el.stickerPanel.hidden) toggleStickerPanel(false); });

async function sendSticker(s) {
  if (!state.me) return;
  toggleStickerPanel(false);
  const { data, error } = await sb.from("messages")
    .insert({ kind: "sticker", sticker: s.id, content: `(이모티콘) ${s.label}` })
    .select().single();
  if (error) {
    toast(/sticker|kind/i.test(error.message)
      ? "이모티콘을 쓰려면 Supabase에서 update-3-stickers.sql 을 먼저 실행해 주세요."
      : `보내지 못했어요: ${error.message}`, 5000);
    return;
  }
  addMessages([data]);
}

function renderEventCard(m) {
  const ev = cal?.get(m.event_id);
  if (!ev) return null;
  const card = document.createElement("div");
  card.className = "bubble event-card";

  const label = document.createElement("div");
  label.className = "ev-label";
  label.textContent = m.kind === "event_edit" ? "📅 일정 변경" : "📅 새 일정";
  const title = document.createElement("div");
  title.className = "ev-title";
  title.textContent = ev.title;
  const when = document.createElement("div");
  when.className = "ev-when";
  when.textContent = whenText(ev);
  card.append(label, title, when);

  if (ev.who?.length) {
    const who = document.createElement("div");
    who.className = "ev-who";
    who.textContent = ev.who.join(", ");
    card.append(who);
  }
  const open = document.createElement("button");
  open.type = "button";
  open.className = "ev-open";
  open.textContent = "달력에서 보기";
  open.addEventListener("click", () => {
    switchTab("cal");
    cal.openDay(cal.nextDate(ev));
  });
  card.append(open);
  return card;
}

async function announceEvent(kind, ev) {
  const { data, error } = await sb.from("messages")
    .insert({ content: announceText(ev, kind), kind, event_id: ev.id })
    .select().single();
  if (error) return toast(`채팅방에 알리지 못했어요: ${error.message}`);
  addMessages([data]);
}

// 일정이 바뀌면 채팅 속 일정 카드와 '오늘 일정'을 다시 그림
function eventsChanged() {
  updateTodayStrip();
  if (!state.messages.some((m) => m.event_id)) return;
  const nearBottom = isNearBottom();
  const top = el.list.scrollTop;
  renderAll();
  if (nearBottom) el.list.scrollTop = el.list.scrollHeight;
  else el.list.scrollTop = top;
}

function updateTodayStrip() {
  const items = cal ? cal.eventsOn(todayStr()) : [];
  if (!items.length) { el.todayStrip.hidden = true; return; }
  const first = items[0].ev;
  const time = first.all_day ? "" : ` ${timeText(first)}`;
  const rest = items.length > 1 ? ` 외 ${items.length - 1}건` : "";
  const b = document.createElement("b");
  b.textContent = "📅 오늘";
  el.todayStrip.replaceChildren(b, ` · ${first.title}${time}${rest}`);
  el.todayStrip.hidden = false;
}
el.todayStrip.addEventListener("click", () => {
  switchTab("cal");
  cal?.openDay(todayStr());
});

function savedTab() {
  try { return localStorage.getItem("tab") === "cal" ? "cal" : "chat"; } catch { return "chat"; }
}

function switchTab(tab) {
  state.tab = tab;
  try { localStorage.setItem("tab", tab); } catch { /* 무시 */ }
  for (const b of el.tabs) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  el.paneChat.hidden = tab !== "chat";
  el.paneCal.hidden = tab !== "cal";
  if (tab === "chat") {
    el.chatDot.hidden = true;
    scrollToBottom();
    markReadSoon();
  }
}
for (const b of el.tabs) b.addEventListener("click", () => switchTab(b.dataset.tab));

// 안 읽은 사람 수 (보낸 사람과 나는 제외)
function updateUnreadCounts() {
  if (!state.me) return;
  const others = [...state.members.keys()].filter((id) => id !== state.me.id);
  for (const node of el.list.querySelectorAll(".msg")) {
    const m = state.byId.get(Number(node.dataset.id));
    if (!m) continue;
    const created = new Date(m.created_at);
    const count = others.filter((uid) => uid !== m.user_id && !(state.reads.get(uid) >= created)).length;
    node.querySelector(".unread").textContent = count > 0 ? String(count) : "";
  }
}

// ---------------------------------------------------------------------
// 읽음 처리
// ---------------------------------------------------------------------
let markTimer = null;
function markReadSoon() {
  clearTimeout(markTimer);
  markTimer = setTimeout(markRead, 400);
}

async function markRead() {
  if (!state.me || document.visibilityState !== "visible" || state.tab !== "chat") return;
  navigator.clearAppBadge?.().catch(() => {});
  const last = state.messages.at(-1);
  const mine = state.reads.get(state.me.id);
  if (!last || (mine && mine >= new Date(last.created_at))) return;
  const { data, error } = await sb.rpc("mark_read");
  if (!error && data) state.reads.set(state.me.id, new Date(data));
}

// ---------------------------------------------------------------------
// 스크롤
// ---------------------------------------------------------------------
function isNearBottom(margin = 120) {
  return el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < margin;
}
function scrollToBottom() {
  el.list.scrollTop = el.list.scrollHeight;
  el.newPill.hidden = true;
  // 사진이 나중에 로드되며 높이가 바뀌는 경우 대비
  requestAnimationFrame(() => { el.list.scrollTop = el.list.scrollHeight; });
}
el.list.addEventListener("scroll", () => {
  if (el.list.scrollTop < 80) loadOlder();
  if (isNearBottom()) el.newPill.hidden = true;
}, { passive: true });
el.newPill.addEventListener("click", scrollToBottom);

// ---------------------------------------------------------------------
// 보내기
// ---------------------------------------------------------------------
function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight + 2, 140) + "px";
  el.send.disabled = !el.input.value.trim();
}
el.input.addEventListener("input", autoGrow);
el.input.addEventListener("keydown", (e) => {
  // PC: Enter = 보내기, Shift+Enter = 줄바꿈 / 휴대폰·태블릿: Enter = 줄바꿈
  if (e.key === "Enter" && !e.shiftKey && !isTouch && !e.isComposing) {
    e.preventDefault();
    sendText();
  }
});
el.composer.addEventListener("submit", (e) => { e.preventDefault(); sendText(); });

async function sendText() {
  const text = el.input.value.trim();
  if (!text || !state.me) return;
  el.input.value = "";
  autoGrow();
  if (isTouch) el.input.focus();
  const { data, error } = await sb.from("messages").insert({ content: text }).select().single();
  if (error) {
    el.input.value = text;
    autoGrow();
    toast(`보내지 못했어요: ${error.message}`);
    return;
  }
  addMessages([data]);
}

el.file.addEventListener("change", () => {
  const files = [...el.file.files];
  el.file.value = "";
  sendImages(files);
});

// PC: 붙여넣기, 끌어다 놓기
document.addEventListener("paste", (e) => {
  if (!state.me) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); sendImages(files); }
});
el.chat.addEventListener("dragover", (e) => { e.preventDefault(); el.chat.classList.add("dragging"); });
el.chat.addEventListener("dragleave", (e) => { if (e.target === el.chat || !el.chat.contains(e.relatedTarget)) el.chat.classList.remove("dragging"); });
el.chat.addEventListener("drop", (e) => {
  e.preventDefault();
  el.chat.classList.remove("dragging");
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) sendImages(files);
});

async function sendImages(files) {
  const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  for (const [i, file] of images.entries()) {
    toast(images.length > 1 ? `사진 보내는 중… (${i + 1}/${images.length})` : "사진 보내는 중…", 0);
    try {
      const { blob, thumb, width, height } = await compressImage(file);
      const id = crypto.randomUUID();
      const path = `${state.me.id}/${id}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (up.error) throw up.error;

      // 미리보기 사진 (실패해도 큰 사진만으로 보내요)
      let thumbPath = null;
      if (thumb && !thumbColumnMissing) {
        const tp = `${state.me.id}/${id}_t.jpg`;
        const upT = await sb.storage.from(BUCKET).upload(tp, thumb, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (!upT.error) thumbPath = tp;
      }

      const row = { image_path: path, image_width: width, image_height: height };
      if (thumbPath) row.thumb_path = thumbPath;
      let { data, error } = await sb.from("messages").insert(row).select().single();
      if (error && thumbPath && /thumb_path/.test(error.message)) {
        // DB에 thumb_path 컬럼이 아직 없으면 미리보기 없이 다시 보냄
        thumbColumnMissing = true;
        sb.storage.from(BUCKET).remove([thumbPath]);
        delete row.thumb_path;
        ({ data, error } = await sb.from("messages").insert(row).select().single());
      }
      if (error) throw error;
      await addMessages([data]);
    } catch (e) {
      console.error(e);
      toast(`사진을 보내지 못했어요: ${e.message || e}`);
      return;
    }
  }
  hideToast();
}

// 사진 압축: 큰 사진(긴 변 1600px, 보통 200~400KB) + 미리보기(긴 변 520px, 보통 30~60KB)
async function compressImage(file) {
  const source = await decodeImage(file);
  const w0 = source.width, h0 = source.height;
  const render = (maxSide, quality) => {
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // 투명 PNG 배경
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve({ blob: b, w, h }) : reject(new Error("이미지 변환 실패"))), "image/jpeg", quality));
  };
  try {
    const full = await render(MAX_IMAGE_SIDE, IMAGE_QUALITY);
    const small = Math.max(w0, h0) > THUMB_SIDE * 1.3 ? await render(THUMB_SIDE, THUMB_QUALITY).catch(() => null) : null;
    return { blob: full.blob, thumb: small?.blob ?? null, width: full.w, height: full.h };
  } finally {
    source.close?.();
  }
}

// 삭제된 메시지의 사진은 기기 저장소에서도 지움
function evictCachedImages(m) {
  if (!m?.image_path || !("caches" in window)) return;
  const base = `${CONFIG.SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/`;
  caches.open(IMAGE_CACHE).then((c) => {
    for (const p of [m.image_path, m.thumb_path]) if (p) c.delete(base + p);
  }).catch(() => {});
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* 아래 방식으로 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("이 사진 형식은 열 수 없어요");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ---------------------------------------------------------------------
// 내 메시지 삭제 (PC: 오른쪽 클릭 / 휴대폰: 길게 누르기)
// ---------------------------------------------------------------------
function attachDeleteGesture(bubble, m) {
  let timer = null;
  const cancel = () => clearTimeout(timer);
  bubble.addEventListener("contextmenu", (e) => { e.preventDefault(); confirmDelete(m); });
  bubble.addEventListener("touchstart", () => { timer = setTimeout(() => confirmDelete(m), 550); }, { passive: true });
  bubble.addEventListener("touchend", cancel);
  bubble.addEventListener("touchmove", cancel, { passive: true });
  bubble.addEventListener("touchcancel", cancel);
}

async function confirmDelete(m) {
  if (!confirm("이 메시지를 삭제할까요?")) return;
  const { error } = await sb.from("messages").delete().eq("id", m.id);
  if (error) return toast(`삭제하지 못했어요: ${error.message}`);
  if (m.image_path) sb.storage.from(BUCKET).remove([m.image_path, m.thumb_path].filter(Boolean));
  removeMessage(m.id);
}

// ---------------------------------------------------------------------
// 사진 크게 보기: 미리보기를 먼저 보여주고, 큰 사진을 받으면 바꿔 끼움
// ---------------------------------------------------------------------
async function openPhoto(m, previewSrc) {
  const big = $("img", el.lightbox);
  big.crossOrigin = "anonymous";
  if (previewSrc) big.src = previewSrc;
  el.lightbox.hidden = false;
  if (!m.thumb_path) return; // 예전 사진은 이미 큰 사진

  let url = state.urls.get(m.image_path);
  if (!url) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(m.image_path, URL_TTL);
    if (error || !data?.signedUrl) return;
    url = data.signedUrl;
    state.urls.set(m.image_path, url);
  }
  if (el.lightbox.hidden) return;
  const loader = new Image();
  loader.crossOrigin = "anonymous";
  loader.onload = () => { if (!el.lightbox.hidden) big.src = url; };
  loader.src = url;
}
el.lightbox.addEventListener("click", () => { el.lightbox.hidden = true; });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { el.lightbox.hidden = true; el.menu.hidden = true; }
});

// ---------------------------------------------------------------------
// 메뉴
// ---------------------------------------------------------------------
el.menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  el.menu.hidden = !el.menu.hidden;
  el.menuBtn.setAttribute("aria-expanded", String(!el.menu.hidden));
});
document.addEventListener("click", (e) => {
  if (!el.menu.hidden && !el.menu.contains(e.target)) el.menu.hidden = true;
});
el.menu.addEventListener("click", async (e) => {
  const act = e.target.closest("button")?.dataset.act;
  el.menu.hidden = true;
  if (act === "logout") {
    if (!confirm("로그아웃할까요? 이 기기에서는 알림도 꺼져요.")) return;
    await disablePush(true);
    await sb.auth.signOut();
  } else if (act === "password") {
    const pw = prompt("새 비밀번호 (6자 이상)");
    if (!pw) return;
    if (pw.length < 6) return toast("비밀번호는 6자 이상이어야 해요.");
    if (prompt("한 번 더 입력해 주세요") !== pw) return toast("두 비밀번호가 달라요.");
    const { error } = await sb.auth.updateUser({ password: pw });
    toast(error ? `변경하지 못했어요: ${error.message}` : "비밀번호를 바꿨어요.");
  }
});

// ---------------------------------------------------------------------
// 푸시 알림
// ---------------------------------------------------------------------
async function getSubscription() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function refreshBell() {
  if (!CONFIG.VAPID_PUBLIC_KEY) { el.bell.hidden = true; return; }
  el.bell.hidden = false;
  let s;
  if (!pushSupported) s = isIOS && !isStandalone ? "install" : "unsupported";
  else if (Notification.permission === "denied") s = "denied";
  else s = (Notification.permission === "granted" && await getSubscription()) ? "on" : "off";
  el.bell.dataset.state = s;
  el.bell.title = { on: "알림 켜짐", off: "알림 켜기", denied: "알림이 차단됨", install: "알림 사용 방법", unsupported: "알림 미지원" }[s];
}

el.bell.addEventListener("click", async () => {
  const s = el.bell.dataset.state;
  if (s === "install") {
    alert("아이패드/아이폰에서 알림을 받으려면\n\n1. Safari 공유 버튼(□↑)을 누르고\n2. '홈 화면에 추가'를 선택한 뒤\n3. 홈 화면의 아이콘으로 앱을 열어\n4. 다시 이 종 버튼을 눌러 주세요.");
  } else if (s === "unsupported") {
    alert("이 브라우저에서는 알림을 지원하지 않아요. Chrome, Edge, 삼성 인터넷 또는 Safari(홈 화면 앱)를 사용해 주세요.");
  } else if (s === "denied") {
    alert("알림이 차단되어 있어요. 브라우저 주소창의 자물쇠 아이콘이나 기기 설정에서 이 앱의 알림을 허용한 뒤 다시 눌러 주세요.");
  } else if (s === "on") {
    if (confirm("이 기기에서 알림을 끌까요?")) { await disablePush(); toast("알림을 껐어요."); }
  } else {
    await enablePush();
  }
  refreshBell();
});

async function enablePush() {
  try {
    const perm = await Notification.requestPermission(); // iOS는 버튼을 누른 직후에만 허용 창이 떠요
    if (perm !== "granted") { toast("알림이 허용되지 않았어요."); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8(CONFIG.VAPID_PUBLIC_KEY),
      });
    }
    await savePush(sub);
    toast("이 기기에서 알림을 받아요 🔔");
  } catch (e) {
    console.error(e);
    toast(`알림을 켜지 못했어요: ${e.message || e}`);
  }
}

async function disablePush(quiet = false) {
  try {
    const sub = await getSubscription();
    if (!sub) return;
    await sb.rpc("remove_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch (e) {
    if (!quiet) toast(`알림을 끄지 못했어요: ${e.message || e}`);
  }
}

async function savePush(sub) {
  const j = sub.toJSON();
  const { error } = await sb.rpc("save_push_subscription", {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) throw error;
}

// 로그인할 때마다 이 기기의 구독을 현재 사용자로 다시 저장
async function resyncPushSubscription() {
  if (!pushSupported || !CONFIG.VAPID_PUBLIC_KEY || Notification.permission !== "granted") return;
  try {
    const sub = await getSubscription();
    if (sub) await savePush(sub);
  } catch (e) { console.warn(e); }
}

function base64UrlToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------
// 홈 화면 설치 안내
// ---------------------------------------------------------------------
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  if (state.me) showInstallHint();
});

function dismissed() {
  try { return localStorage.getItem("install-hint-dismissed") === "1"; } catch { return false; }
}

function showInstallHint() {
  if (isStandalone || dismissed()) return;
  const p = $("p", el.banner);
  const action = $(".banner-action", el.banner);
  if (installPrompt) {
    p.textContent = "앱으로 설치하면 더 편하게 쓰고 알림도 받을 수 있어요.";
    action.hidden = false;
  } else if (isIOS) {
    p.textContent = "Safari 공유 버튼(□↑) → '홈 화면에 추가'를 누르면 앱처럼 쓰고 알림도 받을 수 있어요.";
    action.hidden = true;
  } else {
    return;
  }
  el.banner.hidden = false;
}

$(".banner-action", el.banner).addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  el.banner.hidden = true;
});
$(".banner-close", el.banner).addEventListener("click", () => {
  el.banner.hidden = true;
  try { localStorage.setItem("install-hint-dismissed", "1"); } catch { /* 무시 */ }
});

// ---------------------------------------------------------------------
// 기타
// ---------------------------------------------------------------------
let toastTimer = null;
function toast(message, ms = 3000) {
  clearTimeout(toastTimer);
  // 일정 창이 열려 있으면 그 위에 보이도록 창 안으로 옮김
  const host = document.querySelector("dialog[open]") || document.body;
  if (el.toast.parentElement !== host) host.append(el.toast);
  el.toast.textContent = message;
  el.toast.hidden = false;
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { el.toast.hidden = true; }

// iOS: 키보드가 올라올 때 입력창이 가려지지 않도록 화면 높이를 맞춤
function fitViewportForIOS() {
  if (!isIOS || !window.visualViewport) return;
  const vv = window.visualViewport;
  const fit = () => {
    document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
    window.scrollTo(0, 0);
    if (isNearBottom()) el.list.scrollTop = el.list.scrollHeight;
  };
  vv.addEventListener("resize", fit);
  fit();
}
