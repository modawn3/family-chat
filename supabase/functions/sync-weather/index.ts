// =========================================================
// sync-weather
// 기상청 단기예보(오늘~4일 후) + 중기예보(~10일 후)를 받아
// weather 테이블에 날짜별로 저장하는 서버 함수. 3시간마다 자동 실행됨.
//
// 필요한 비밀 값 (Edge Functions > Secrets, 공휴일 함수와 같은 것을 같이 씀)
//   HOLIDAY_API_KEY : 공공데이터포털 일반 인증키(Decoding)
//   CRON_SECRET     : (선택) 예약 실행 암호. 없으면 DB 의 chat.app_config 값을 씀
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

/* ---------- 지역 설정: 충청북도 청주시 흥덕구 ---------- */
const NX = 68, NY = 107;              // 단기예보 격자 (흥덕구청·복대동 부근)
const MID_LAND_REG = "11C10000";      // 중기 육상예보: 충청북도
const MID_TA_REG = "11C10301";        // 중기 기온예보: 청주

const BASE = "https://apis.data.go.kr/1360000";
const SHORT_URL = `${BASE}/VilageFcstInfoService_2.0/getVilageFcst`;
const MID_LAND_URL = `${BASE}/MidFcstInfoService/getMidLandFcst`;
const MID_TA_URL = `${BASE}/MidFcstInfoService/getMidTa`;

type Code = "clear" | "partly" | "cloudy" | "rain" | "sleet" | "snow" | "shower";
const LABEL: Record<Code, string> = {
  clear: "맑음", partly: "구름많음", cloudy: "흐림", rain: "비", sleet: "비/눈", snow: "눈", shower: "소나기",
};
type Row = { date: string; code: Code; wf: string; tmin: number | null; tmax: number | null; pop: number | null; src: string; updated_at: string };

/* ---------- 한국 시간 도우미 ---------- */
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);       // UTC 메서드로 읽으면 한국 시각
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const dash = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const addDays = (s: string, n: number) => {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + n));
  return ymd(d);
};

/* ---------- 공통 호출 ---------- */
async function call(url: string, params: Record<string, string>, key: string) {
  const u = new URL(url);
  u.searchParams.set("serviceKey", key);
  u.searchParams.set("dataType", "JSON");
  u.searchParams.set("pageNo", "1");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`응답 오류: ${text.slice(0, 200)}`); }
  const h = data?.response?.header;
  if (h?.resultCode !== "00") throw new Error(`응답 오류: ${h?.resultCode} ${h?.resultMsg}`);
  const item = data?.response?.body?.items?.item ?? [];
  return Array.isArray(item) ? item : [item];
}

/* ---------- 단기예보 ---------- */
// 발표 시각: 02,05,08,11,14,17,20,23시 (발표 후 약 10분 뒤부터 조회 가능)
function latestShortBase(now: Date) {
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes() - 15;
  const hours = [23, 20, 17, 14, 11, 8, 5, 2];
  for (const h of hours) if (mins >= h * 60) return { date: ymd(now), time: pad(h) + "00" };
  return { date: addDays(ymd(now), -1), time: "2300" };
}
// 오늘 하루 전체(최저기온 포함)가 들어있는 첫 발표: 02시 (02:15 전이면 전날 23시)
function dayStartShortBase(now: Date) {
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= 2 * 60 + 15 ? { date: ymd(now), time: "0200" } : { date: addDays(ymd(now), -1), time: "2300" };
}

type Hourly = Record<string, Record<string, Record<string, string>>>; // date -> time -> category -> value
function collect(items: any[], into: Hourly, overwrite: boolean) {
  for (const it of items) {
    const d = it.fcstDate, t = it.fcstTime;
    into[d] ??= {};
    into[d][t] ??= {};
    if (overwrite || into[d][t][it.category] === undefined) into[d][t][it.category] = String(it.fcstValue);
  }
}

function summarizeShort(hourly: Hourly, today: string, now: string): Row[] {
  const rows: Row[] = [];
  for (const d of Object.keys(hourly).sort()) {
    if (d < today) continue;
    const hours = hourly[d];
    const times = Object.keys(hours).sort();
    const day = times.filter((t) => t >= "0600" && t <= "2100");
    const use = day.length ? day : times;
    const pick = (cat: string) => use.map((t) => hours[t][cat]).filter((v) => v !== undefined);

    // 날씨: 강수가 있으면 강수 형태, 없으면 낮 동안 가장 흔한 하늘 상태
    const pty = pick("PTY").map(Number);
    let code: Code;
    if (pty.includes(3)) code = "snow";
    else if (pty.includes(2)) code = "sleet";
    else if (pty.includes(1)) code = "rain";
    else if (pty.includes(4)) code = "shower";
    else {
      const sky = pick("SKY").map(Number);
      const count = (v: number) => sky.filter((x) => x === v).length;
      const best = [4, 3, 1].reduce((a, b) => (count(b) > count(a) ? b : a), 1);
      code = best === 4 ? "cloudy" : best === 3 ? "partly" : "clear";
    }

    // 기온: 최저(TMN)·최고(TMX) 우선, 없으면 시간별 기온에서 계산
    const all = times.map((t) => hours[t]);
    const tmp = all.map((h) => h.TMP).filter((v) => v !== undefined).map(Number);
    const tmn = all.map((h) => h.TMN).find((v) => v !== undefined);
    const tmx = all.map((h) => h.TMX).find((v) => v !== undefined);
    const tmin = tmn !== undefined ? Math.round(+tmn) : tmp.length ? Math.min(...tmp) : null;
    const tmax = tmx !== undefined ? Math.round(+tmx) : tmp.length ? Math.max(...tmp) : null;

    // 강수확률: 오늘은 지금 이후 시간만, 나머지 날은 하루 중 가장 높은 값
    const popTimes = d === today ? times.filter((t) => t >= now) : times;
    const pops = popTimes.map((t) => hours[t].POP).filter((v) => v !== undefined).map(Number);
    const pop = pops.length ? Math.max(...pops) : null;

    rows.push({ date: dash(d), code, wf: LABEL[code], tmin, tmax, pop, src: "short", updated_at: new Date().toISOString() });
  }
  return rows;
}

/* ---------- 중기예보 ---------- */
// 발표 시각: 06시, 18시 (30분 여유)
function latestMidTm(now: Date) {
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (mins >= 18 * 60 + 30) return ymd(now) + "1800";
  if (mins >= 6 * 60 + 30) return ymd(now) + "0600";
  return addDays(ymd(now), -1) + "1800";
}
function codeFromText(wf: string | undefined): Code | null {
  if (!wf) return null;
  if (wf.includes("비/눈") || wf.includes("눈/비")) return "sleet";
  if (wf.includes("눈")) return "snow";
  if (wf.includes("소나기")) return "shower";
  if (wf.includes("비")) return "rain";
  if (wf.includes("흐")) return "cloudy";
  if (wf.includes("구름")) return "partly";
  if (wf.includes("맑")) return "clear";
  return null;
}
const SEVERITY: Code[] = ["clear", "partly", "cloudy", "shower", "rain", "sleet", "snow"];

function summarizeMid(land: any, ta: any, tmFc: string): Row[] {
  const rows: Row[] = [];
  const baseDay = tmFc.slice(0, 8);
  for (let n = 3; n <= 10; n++) {
    const wfs = [land?.[`wf${n}Am`], land?.[`wf${n}Pm`], land?.[`wf${n}`]].filter(Boolean) as string[];
    const codes = wfs.map(codeFromText).filter(Boolean) as Code[];
    if (!codes.length) continue;
    const code = codes.reduce((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a));
    const pops = [land?.[`rnSt${n}Am`], land?.[`rnSt${n}Pm`], land?.[`rnSt${n}`]].filter((v) => v !== undefined && v !== null && v !== "").map(Number);
    const tmin = ta?.[`taMin${n}`], tmax = ta?.[`taMax${n}`];
    rows.push({
      date: dash(addDays(baseDay, n)), code, wf: LABEL[code],
      tmin: tmin === undefined || tmin === null || tmin === "" ? null : Number(tmin),
      tmax: tmax === undefined || tmax === null || tmax === "" ? null : Number(tmax),
      pop: pops.length ? Math.max(...pops) : null, src: "mid", updated_at: new Date().toISOString(),
    });
  }
  return rows;
}

/* ---------- 실행 ---------- */
// 예약 실행 암호: Secrets 의 CRON_SECRET, 없으면 DB 의 chat.app_config('cron_secret')
// (예약 실행 SQL 도 같은 DB 값을 보내므로, 암호를 한 곳에만 두면 됨)
async function cronSecret(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const env = Deno.env.get("CRON_SECRET");
  if (env) return env;
  const { data } = await supabase.schema("chat").from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
  return data?.value ?? null;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = await cronSecret(supabase);
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  const key = Deno.env.get("WEATHER_API_KEY") || Deno.env.get("HOLIDAY_API_KEY");
  if (!key) return new Response("HOLIDAY_API_KEY 비밀 값이 없어요", { status: 500 });
  const now = kstNow();
  const today = ymd(now);
  const nowHHMM = pad(now.getUTCHours()) + "00";
  const report: string[] = [];
  const byDate = new Map<string, Row>();

  // 1) 중기예보 (먼저 넣고, 겹치는 날은 아래 단기예보로 덮어씀)
  try {
    const tmFc = latestMidTm(now);
    const [land] = await call(MID_LAND_URL, { regId: MID_LAND_REG, tmFc, numOfRows: "10" }, key);
    const [ta] = await call(MID_TA_URL, { regId: MID_TA_REG, tmFc, numOfRows: "10" }, key);
    const rows = summarizeMid(land, ta, tmFc);
    rows.forEach((r) => byDate.set(r.date, r));
    report.push(`중기예보(${tmFc}): ${rows.length}일`);
  } catch (e) {
    report.push(`중기예보 실패 - ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) 단기예보 (오늘 첫 발표 + 최신 발표를 합쳐서 하루 전체를 채움)
  try {
    const hourly: Hourly = {};
    const latest = latestShortBase(now);
    const start = dayStartShortBase(now);
    const params = (b: { date: string; time: string }) => ({ base_date: b.date, base_time: b.time, nx: String(NX), ny: String(NY), numOfRows: "2000" });
    collect(await call(SHORT_URL, params(latest), key), hourly, true);
    if (start.date !== latest.date || start.time !== latest.time) {
      try { collect(await call(SHORT_URL, params(start), key), hourly, false); } catch { /* 없어도 진행 */ }
    }
    const rows = summarizeShort(hourly, today, nowHHMM);
    rows.forEach((r) => byDate.set(r.date, r));
    report.push(`단기예보(${latest.date} ${latest.time}): ${rows.length}일`);
  } catch (e) {
    report.push(`단기예보 실패 - ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3) 저장 + 지난 날짜 정리
  const rows = [...byDate.values()].filter((r) => r.date >= dash(today)).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length) {
    const { error } = await supabase.from("weather").upsert(rows, { onConflict: "date" });
    if (error) report.push(`저장 실패 - ${error.message}`);
    else report.push(`저장: ${rows.length}일 (${rows[0].date} ~ ${rows[rows.length - 1].date})`);
  }
  await supabase.from("weather").delete().lt("date", dash(today));

  return new Response(JSON.stringify({ report }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
});
