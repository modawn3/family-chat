// 가족 달력: 월 보기, 날짜별 일정, 추가/수정/삭제, 반복 일정
// 날짜는 모두 "YYYY-MM-DD" 문자열로 다뤄요 (시간대 문제 없이 한국 날짜 그대로).

export const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const REPEAT_LABEL = { none: "", weekly: "매주", monthly: "매월", yearly: "매년" };
// 양력 고정 공휴일 (설날·추석 등 음력 명절은 일정으로 등록해 주세요)
const HOLIDAYS = {
  "01-01": "신정", "03-01": "삼일절", "05-05": "어린이날", "06-06": "현충일",
  "08-15": "광복절", "10-03": "개천절", "10-09": "한글날", "12-25": "성탄절",
};
// 가족별 색상 (가족 명단 순서대로). 여러 명이거나 아무도 안 고르면 "가족 모두" 색
const MEMBER_COLORS = ["#3B7DD8", "#D2508A", "#2E9D6A", "#8B5CF6", "#B7791F", "#0E8A96", "#64748B"];
const FAMILY_COLOR = "#D9733B";
const MAX_IN_CELL = 2;

// ---------------------------------------------------------------------
// 날짜 계산
// ---------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
const toUTC = (s) => { const { y, m, d } = parse(s); return Date.UTC(y, m - 1, d); };
const fromUTC = (t) => { const x = new Date(t); return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };
export const addDays = (s, n) => fromUTC(toUTC(s) + n * 86400000);
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
export const dow = (s) => new Date(toUTC(s)).getUTCDay();
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const todayStr = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
// 서버(public.holidays, 공휴일 자동 갱신 함수가 채움)에서 받은 공휴일. 있으면 이걸 먼저 씀 (설날·추석·대체공휴일 포함)
const serverHolidays = new Map();
export function setServerHolidays(rows) {
  serverHolidays.clear();
  for (const r of rows) serverHolidays.set(r.date, r.name);
}
export const holidayOf = (s) => serverHolidays.get(s) || HOLIDAYS[s.slice(5)] || "";

// 일정 ev 가 [from, to] 기간에 걸치는 "시작 날짜" 목록 (반복 일정 포함)
export function occurrences(ev, from, to) {
  const dur = Math.max(0, diffDays(ev.start_date, ev.end_date));
  const out = [];
  const hit = (s) => s >= ev.start_date && s <= to && addDays(s, dur) >= from;

  if (ev.repeat === "weekly") {
    let k = Math.max(0, Math.floor((diffDays(ev.start_date, from) - dur) / 7));
    for (let s = addDays(ev.start_date, 7 * k); s <= to; k++, s = addDays(ev.start_date, 7 * k)) {
      if (hit(s)) out.push(s);
    }
  } else if (ev.repeat === "monthly" || ev.repeat === "yearly") {
    const { y, m, d } = parse(ev.start_date);
    const f = parse(from);
    const step = ev.repeat === "monthly" ? 1 : 12;
    const back = Math.ceil(dur / 28) + 1;
    let k = Math.max(0, Math.floor(((f.y - y) * 12 + (f.m - m) - back) / step));
    for (;; k++) {
      const total = (m - 1) + k * step;
      const yy = y + Math.floor(total / 12);
      const mm = (total % 12) + 1;
      if (ymd(yy, mm, 1) > to) break;
      if (d > daysInMonth(yy, mm)) continue; // 31일, 2월 29일이 없는 달은 건너뜀
      const s = ymd(yy, mm, d);
      if (hit(s)) out.push(s);
    }
  } else if (hit(ev.start_date)) {
    out.push(ev.start_date);
  }
  return out;
}

// ---------------------------------------------------------------------
// 표시용 문구
// ---------------------------------------------------------------------
export function fmtClock(t) {
  if (!t) return "";
  const [h, mi] = t.split(":").map(Number);
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${pad(mi)}`;
}

export function dateLabel(s, withYear = false) {
  const { y, m, d } = parse(s);
  const yearPart = withYear || y !== new Date().getFullYear() ? `${y}년 ` : "";
  return `${yearPart}${m}월 ${d}일 (${WEEK[dow(s)]})`;
}

export function timeText(ev) {
  if (ev.all_day) return "하루 종일";
  return ev.end_time ? `${fmtClock(ev.start_time)} ~ ${fmtClock(ev.end_time)}` : fmtClock(ev.start_time);
}

export function whenText(ev) {
  let s = dateLabel(ev.start_date);
  if (ev.end_date !== ev.start_date) s += ` ~ ${dateLabel(ev.end_date)}`;
  if (!ev.all_day) s += ` ${timeText(ev)}`;
  if (ev.repeat && ev.repeat !== "none") s += ` · ${REPEAT_LABEL[ev.repeat]} 반복`;
  return s;
}

// 채팅방에 올릴 문구 (푸시 알림 내용으로도 쓰여요)
export function announceText(ev, kind) {
  const head = kind === "event_edit" ? "📅 일정 변경" : "📅 새 일정";
  const who = ev.who?.length ? ` · ${ev.who.join(", ")}` : "";
  return `${head}: ${ev.title}\n${whenText(ev)}${who}`;
}

const sortItems = (a, b) =>
  (b.ev.all_day - a.ev.all_day) ||
  String(a.ev.start_time || "").localeCompare(String(b.ev.start_time || "")) ||
  a.ev.title.localeCompare(b.ev.title, "ko");

// ---------------------------------------------------------------------
// 달력 화면
// ---------------------------------------------------------------------
export function createCalendar({ sb, getMemberNames, onAnnounce, onChange, toast }) {
  const $ = (s, root = document) => root.querySelector(s);
  const el = {
    title: $("#cal-title"), grid: $("#cal-grid"), dayTitle: $("#cal-day-title"),
    dayList: $("#cal-day-list"), scroll: $("#cal-scroll"),
    dialog: $("#event-dialog"), form: $("#event-form"), dlgTitle: $("#ev-dialog-title"),
    fTitle: $("#ev-title"), fStart: $("#ev-start"), fEnd: $("#ev-end"), fAllDay: $("#ev-allday"),
    fTimes: $("#ev-times"), fSTime: $("#ev-stime"), fETime: $("#ev-etime"), fWho: $("#ev-who"),
    fRepeat: $("#ev-repeat"), fMemo: $("#ev-memo"), fAnnounce: $("#ev-announce"),
    fAnnounceText: $("#ev-announce-text"), fDelete: $("#ev-delete"), fSave: $("#ev-save"),
  };
  const now = parse(todayStr());
  const st = {
    events: new Map(),
    view: { y: now.y, m: now.m },
    selected: todayStr(),
    editing: null,
    channel: null,
  };

  // ---------- 색상 ----------
  function memberColor(name) {
    const i = getMemberNames().indexOf(name);
    return i < 0 ? MEMBER_COLORS.at(-1) : MEMBER_COLORS[i % MEMBER_COLORS.length];
  }
  const colorOf = (ev) => (ev.who?.length === 1 ? memberColor(ev.who[0]) : FAMILY_COLOR);

  // ---------- 데이터 ----------
  async function start() {
    const { data, error } = await sb.from("events").select("*").order("start_date").limit(5000);
    if (error) throw error;
    st.events = new Map(data.map((e) => [e.id, e]));
    subscribe();
    render();
  }

  function subscribe() {
    if (st.channel) sb.removeChannel(st.channel);
    st.channel = sb.channel("family-calendar")
      .on("postgres_changes", { event: "*", schema: "chat", table: "events" }, (p) => {
        if (p.eventType === "DELETE") st.events.delete(p.old.id);
        else if (p.new?.id) st.events.set(p.new.id, p.new);
        changed();
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") refetch(); });
  }

  async function refetch() {
    const { data, error } = await sb.from("events").select("*").order("start_date").limit(5000);
    if (error) return;
    st.events = new Map(data.map((e) => [e.id, e]));
    changed();
  }

  function stop() {
    if (st.channel) sb.removeChannel(st.channel);
    st.channel = null;
    st.events.clear();
    if (el.dialog.open) el.dialog.close();
  }

  function changed() {
    render();
    onChange?.();
  }

  function itemsInRange(from, to) {
    const byDay = new Map();
    for (const ev of st.events.values()) {
      const dur = Math.max(0, diffDays(ev.start_date, ev.end_date));
      for (const s of occurrences(ev, from, to)) {
        for (let k = 0; k <= dur; k++) {
          const d = addDays(s, k);
          if (d < from || d > to) continue;
          if (!byDay.has(d)) byDay.set(d, []);
          byDay.get(d).push({ ev, occ: s });
        }
      }
    }
    for (const list of byDay.values()) list.sort(sortItems);
    return byDay;
  }

  function eventsOn(day) {
    return itemsInRange(day, day).get(day) || [];
  }

  // 반복 일정이면 오늘 이후 가장 가까운 날, 아니면 시작일
  function nextDate(ev) {
    if (!ev.repeat || ev.repeat === "none") return ev.start_date;
    const t = todayStr();
    return occurrences(ev, t, addDays(t, 400))[0] || ev.start_date;
  }

  // ---------- 그리기 ----------
  function render() {
    const { y, m } = st.view;
    el.title.textContent = `${y}년 ${m}월`;
    const first = ymd(y, m, 1);
    const lead = dow(first);
    const weeks = Math.ceil((lead + daysInMonth(y, m)) / 7);
    const from = addDays(first, -lead);
    const to = addDays(from, weeks * 7 - 1);
    const byDay = itemsInRange(from, to);
    const today = todayStr();

    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const day = addDays(from, i);
      const p = parse(day);
      const hol = holidayOf(day);
      const items = byDay.get(day) || [];

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.date = day;
      if (p.m !== m) cell.classList.add("out");
      if (day === today) cell.classList.add("today");
      if (day === st.selected) cell.classList.add("selected");
      if (i % 7 === 0 || hol) cell.classList.add("red");
      else if (i % 7 === 6) cell.classList.add("blue");
      cell.setAttribute("aria-label",
        `${p.m}월 ${p.d}일${hol ? ` ${hol}` : ""}${items.length ? `, 일정 ${items.length}개` : ""}`);

      const head = document.createElement("div");
      head.className = "cell-head";
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = p.d;
      head.append(num);
      if (hol) {
        const h = document.createElement("span");
        h.className = "hol";
        h.textContent = hol;
        head.append(h);
      }
      cell.append(head);

      for (const it of items.slice(0, MAX_IN_CELL)) {
        const pill = document.createElement("span");
        pill.className = "ev";
        pill.style.setProperty("--c", colorOf(it.ev));
        pill.textContent = it.ev.title;
        cell.append(pill);
      }
      if (items.length > MAX_IN_CELL) {
        const more = document.createElement("span");
        more.className = "more";
        more.textContent = `+${items.length - MAX_IN_CELL}`;
        cell.append(more);
      }
      cells.push(cell);
    }
    el.grid.replaceChildren(...cells);
    renderDay();
  }

  function renderDay() {
    const day = st.selected;
    const hol = holidayOf(day);
    el.dayTitle.textContent = `${dateLabel(day)}${hol ? ` · ${hol}` : ""}${day === todayStr() ? " · 오늘" : ""}`;
    const items = eventsOn(day);
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "day-empty";
      empty.textContent = "일정이 없어요";
      el.dayList.replaceChildren(empty);
      return;
    }
    el.dayList.replaceChildren(...items.map(({ ev }) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "item";
      btn.style.setProperty("--c", colorOf(ev));
      btn.addEventListener("click", () => openEditor(ev));

      const when = document.createElement("div");
      when.className = "item-when";
      when.textContent = timeText(ev);
      if (ev.end_date !== ev.start_date) {
        when.textContent += ` · ${parse(ev.start_date).m}/${parse(ev.start_date).d}~${parse(ev.end_date).m}/${parse(ev.end_date).d}`;
      }
      if (ev.repeat !== "none") when.textContent += ` · 🔁 ${REPEAT_LABEL[ev.repeat]}`;

      const title = document.createElement("div");
      title.className = "item-title";
      title.textContent = ev.title;
      btn.append(when, title);

      const whoNames = ev.who?.length ? ev.who : ["가족 모두"];
      const who = document.createElement("div");
      who.className = "item-who";
      for (const n of whoNames) {
        const chip = document.createElement("span");
        chip.className = "who-chip";
        chip.style.setProperty("--c", ev.who?.length ? memberColor(n) : FAMILY_COLOR);
        chip.textContent = n;
        who.append(chip);
      }
      btn.append(who);

      if (ev.memo) {
        const memo = document.createElement("div");
        memo.className = "item-memo";
        memo.textContent = ev.memo;
        btn.append(memo);
      }
      li.append(btn);
      return li;
    }));
  }

  // ---------- 이동 ----------
  function moveMonth(delta) {
    let { y, m } = st.view;
    m += delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    st.view = { y, m };
    const t = parse(todayStr());
    st.selected = t.y === y && t.m === m ? todayStr() : ymd(y, m, 1);
    render();
  }

  function openDay(day) {
    const p = parse(day);
    st.view = { y: p.y, m: p.m };
    st.selected = day;
    render();
    el.dayTitle.scrollIntoView({ block: "nearest" });
  }

  $("#cal-prev").addEventListener("click", () => moveMonth(-1));
  $("#cal-next").addEventListener("click", () => moveMonth(1));
  $("#cal-today").addEventListener("click", () => openDay(todayStr()));
  $("#cal-add").addEventListener("click", () => openEditor(null, st.selected));

  el.grid.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    const day = cell.dataset.date;
    if (day === st.selected) { openEditor(null, day); return; } // 같은 날 한 번 더 누르면 바로 추가
    const p = parse(day);
    if (p.m !== st.view.m) st.view = { y: p.y, m: p.m };
    st.selected = day;
    render();
  });

  // 휴대폰·태블릿: 달력을 옆으로 밀어 달 이동
  let touch = null;
  el.grid.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  el.grid.addEventListener("touchend", (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) moveMonth(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ---------- 일정 추가/수정 창 ----------
  function buildWhoChips(selected) {
    const names = [...getMemberNames()];
    for (const n of selected) if (!names.includes(n)) names.push(n); // 이름이 바뀐 예전 가족
    el.fWho.replaceChildren(...names.map((n) => {
      const label = document.createElement("label");
      label.className = "chip";
      label.style.setProperty("--c", memberColor(n));
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = n;
      input.checked = selected.includes(n);
      const span = document.createElement("span");
      span.textContent = n;
      label.append(input, span);
      return label;
    }));
  }

  function syncTimes() {
    el.fTimes.hidden = el.fAllDay.checked;
  }

  function openEditor(ev, day) {
    st.editing = ev || null;
    el.dlgTitle.textContent = ev ? "일정 수정" : "일정 추가";
    el.fTitle.value = ev?.title ?? "";
    el.fStart.value = ev?.start_date ?? day ?? st.selected;
    el.fEnd.value = ev?.end_date ?? el.fStart.value;
    el.fEnd.min = el.fStart.value;
    el.fAllDay.checked = ev ? ev.all_day : true;
    el.fSTime.value = ev?.start_time?.slice(0, 5) ?? "09:00";
    el.fETime.value = ev?.end_time?.slice(0, 5) ?? "";
    buildWhoChips(ev?.who ?? []);
    el.fRepeat.value = ev?.repeat ?? "none";
    el.fMemo.value = ev?.memo ?? "";
    el.fAnnounce.checked = !ev;
    el.fAnnounceText.textContent = ev ? "채팅방에 변경 알리기" : "채팅방에 알리기";
    el.fDelete.hidden = !ev;
    el.fSave.disabled = false;
    syncTimes();
    el.dialog.showModal();
    el.form.scrollTop = 0;
    if (!matchMedia("(pointer: coarse)").matches) el.fTitle.focus();
    else el.dialog.focus();
  }

  el.fAllDay.addEventListener("change", syncTimes);
  el.fStart.addEventListener("change", () => {
    el.fEnd.min = el.fStart.value;
    if (!el.fEnd.value || el.fEnd.value < el.fStart.value) el.fEnd.value = el.fStart.value;
  });
  $("#ev-cancel").addEventListener("click", () => el.dialog.close());
  el.dialog.addEventListener("click", (e) => { if (e.target === el.dialog) el.dialog.close(); });

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = el.fTitle.value.trim();
    const start_date = el.fStart.value;
    const end_date = el.fEnd.value || start_date;
    const all_day = el.fAllDay.checked;
    const start_time = all_day ? null : el.fSTime.value || null;
    const end_time = all_day ? null : el.fETime.value || null;

    if (!title) return toast("제목을 입력해 주세요.");
    if (!start_date) return toast("날짜를 골라 주세요.");
    if (end_date < start_date) return toast("끝나는 날이 시작하는 날보다 빨라요.");
    if (!all_day && !start_time) return toast("시작 시간을 입력해 주세요.");
    if (!all_day && end_time && start_date === end_date && end_time < start_time) {
      return toast("끝나는 시간이 시작 시간보다 빨라요.");
    }

    const payload = {
      title, start_date, end_date, all_day, start_time, end_time,
      who: [...el.fWho.querySelectorAll("input:checked")].map((i) => i.value),
      repeat: el.fRepeat.value,
      memo: el.fMemo.value.trim() || null,
    };
    const announce = el.fAnnounce.checked;
    const editing = st.editing;

    el.fSave.disabled = true;
    const q = editing
      ? sb.from("events").update(payload).eq("id", editing.id)
      : sb.from("events").insert(payload);
    const { data, error } = await q.select().single();
    el.fSave.disabled = false;
    if (error) return toast(`저장하지 못했어요: ${error.message}`);

    st.events.set(data.id, data);
    el.dialog.close();
    openDay(data.start_date);
    onChange?.();
    toast(editing ? "일정을 바꿨어요." : "일정을 등록했어요.");
    if (announce) onAnnounce?.(editing ? "event_edit" : "event_new", data);
  });

  el.fDelete.addEventListener("click", async () => {
    const ev = st.editing;
    if (!ev) return;
    const msg = ev.repeat !== "none"
      ? `'${ev.title}' 반복 일정을 모두 삭제할까요?`
      : `'${ev.title}' 일정을 삭제할까요?`;
    if (!confirm(msg)) return;
    const { error } = await sb.from("events").delete().eq("id", ev.id);
    if (error) return toast(`삭제하지 못했어요: ${error.message}`);
    st.events.delete(ev.id);
    el.dialog.close();
    changed();
    toast("일정을 삭제했어요.");
  });

  return {
    start, stop, render, openDay, eventsOn, nextDate, colorOf,
    get: (id) => st.events.get(id),
  };
}
