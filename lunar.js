// 음력 날짜: 브라우저에 들어 있는 한국 음력(dangi) 달력을 씀 → 따로 표나 라이브러리가 필요 없음
// 한국 음력을 모르는 브라우저는 중국 음력(chinese)으로 대신함(드물게 하루 차이 날 수 있음)
const fmt = (() => {
  for (const ca of ["dangi", "chinese"]) {
    try {
      const f = new Intl.DateTimeFormat(`ko-KR-u-ca-${ca}`, { month: "numeric", day: "numeric", timeZone: "UTC" });
      if (f.resolvedOptions().calendar === ca) return f;
    } catch { /* 다음 후보 */ }
  }
  return null;
})();
const cache = new Map();

// "2026-10-15" → { m: 9, d: 5, leap: false } (모르는 환경이면 null)
export function lunarOf(s) {
  if (!fmt) return null;
  if (cache.has(s)) return cache.get(s);
  let out = null;
  try {
    const [y, mo, d] = s.split("-").map(Number);
    const parts = fmt.formatToParts(new Date(Date.UTC(y, mo - 1, d, 12)));
    const mStr = parts.find((p) => p.type === "month")?.value || "";
    const dStr = parts.find((p) => p.type === "day")?.value || "";
    const m = parseInt(mStr.replace(/\D/g, ""), 10);
    const dd = parseInt(dStr, 10);
    if (m && dd) out = { m, d: dd, leap: /윤|bis|leap/i.test(mStr) };
  } catch { /* 표시 안 함 */ }
  cache.set(s, out);
  return out;
}

// 달력 칸에 쓰는 짧은 글자: "9.5", 윤달은 "윤6.1"
export function lunarShort(s) {
  const l = lunarOf(s);
  return l ? `${l.leap ? "윤" : ""}${l.m}.${l.d}` : "";
}

// 날짜 제목에 쓰는 글자: "음력 9월 5일", 윤달은 "음력 윤6월 1일"
export function lunarLong(s) {
  const l = lunarOf(s);
  return l ? `음력 ${l.leap ? "윤" : ""}${l.m}월 ${l.d}일` : "";
}
