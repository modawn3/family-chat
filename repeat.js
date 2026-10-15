// 고정(반복) 일정: 반복 규칙 → 실제 날짜 목록
// 내 달력(my/)이 반복 일정을 만들 때 씀. 날짜 계산만 하는 순수 함수라 node 로 테스트할 수 있어요.
import { lunarOf } from "./lunar.js";

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };

export const DOW = ["일", "월", "화", "수", "목", "금", "토"];

// series: { kind, weekdays, start_date, until }
// from ~ to (둘 다 포함) 사이에서 반복되는 날짜들 ("YYYY-MM-DD" 배열)
export function seriesDates(series, from, to) {
  const start = series.start_date;
  const a = from > start ? from : start;
  const b = series.until && series.until < to ? series.until : to;
  if (a > b) return [];
  const base = parse(start);
  const out = [];
  if (series.kind === "lunar_yearly") {
    const lb = lunarOf(start);
    if (!lb) return [];
    // 음력 30일이 없는 달(작은달)에는 29일에 표시
    for (let s = a; s <= b; s = addDays(s, 1)) {
      const l = lunarOf(s);
      if (!l || l.leap || l.m !== lb.m) continue;
      if (l.d === lb.d) out.push(s);
      else if (lb.d === 30 && l.d === 29) {
        const n = lunarOf(addDays(s, 1));
        if (!n || n.d !== 30) out.push(s);
      }
    }
    return out;
  }
  for (let s = a; s <= b; s = addDays(s, 1)) {
    const d = parse(s);
    if (series.kind === "weekly") {
      const days = series.weekdays && series.weekdays.length ? series.weekdays : [base.getDay()];
      if (days.includes(d.getDay())) out.push(s);
    } else if (series.kind === "monthly") {
      if (d.getDate() === base.getDate()) out.push(s);            // 31일이 없는 달은 건너뜀
    } else if (series.kind === "yearly") {
      if (d.getMonth() === base.getMonth() && d.getDate() === base.getDate()) out.push(s); // 2월 29일은 윤년에만
    }
  }
  return out;
}

// 사람이 읽는 반복 설명: "매주 월·수", "매월 15일", "매년 3월 1일", "매년 음력 9월 5일"
export function seriesText(series) {
  const base = parse(series.start_date);
  let t = "";
  if (series.kind === "weekly") {
    const days = (series.weekdays && series.weekdays.length ? series.weekdays : [base.getDay()]).slice().sort();
    t = days.length === 7 ? "매일" : "매주 " + days.map(i => DOW[i]).join("·");
  } else if (series.kind === "monthly") t = `매월 ${base.getDate()}일`;
  else if (series.kind === "yearly") t = `매년 ${base.getMonth() + 1}월 ${base.getDate()}일`;
  else if (series.kind === "lunar_yearly") {
    const l = lunarOf(series.start_date);
    t = l ? `매년 음력 ${l.m}월 ${l.d}일` : "매년 (음력)";
  }
  if (series.until) { const u = parse(series.until); t += ` · ${u.getFullYear()}.${u.getMonth() + 1}.${u.getDate()}까지`; }
  return t;
}

// 반복으로 만든 하루치 일정의 id: 반복 id + 날짜로 항상 같은 값
// (두 기기가 동시에 이어 만들어도 같은 날이 두 번 생기지 않음)
export async function occurrenceId(seriesId, date) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(seriesId + "|" + date)));
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = Array.from(h.slice(0, 16), b => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
