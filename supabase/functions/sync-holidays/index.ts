// =========================================================
// sync-holidays
// 공공데이터포털 "한국천문연구원 특일 정보" API에서 올해·내년 공휴일을 받아
// holidays 테이블에 저장하는 서버 함수. 매일 새벽 3시에 자동 실행됨.
//
// 필요한 비밀 값 (Edge Functions > Secrets 에 등록)
//   HOLIDAY_API_KEY : 공공데이터포털 일반 인증키(Decoding)
//   CRON_SECRET     : (선택) 예약 실행 암호. 없으면 DB 의 chat.app_config 값을 씀
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

type Item = { locdate: number | string; dateName: string; isHoliday: string };
type Row = { date: string; name: string; source: string; updated_at: string };

// 한 달치 공휴일 받아오기
async function fetchMonth(key: string, year: number, month: number): Promise<Item[]> {
  const url = new URL(API);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("solYear", String(year));
  url.searchParams.set("solMonth", String(month).padStart(2, "0"));
  url.searchParams.set("_type", "json");
  url.searchParams.set("numOfRows", "100");

  const res = await fetch(url);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // 인증키 오류 등은 JSON이 아니라 XML로 옴
    throw new Error(`${year}-${month} 응답 오류: ${text.slice(0, 200)}`);
  }
  const header = data?.response?.header;
  if (header?.resultCode !== "00") {
    throw new Error(`${year}-${month} 응답 오류: ${header?.resultCode} ${header?.resultMsg}`);
  }
  const items = data?.response?.body?.items?.item;
  if (!items) return [];                       // 그 달에 공휴일 없음
  return Array.isArray(items) ? items : [items]; // 1개면 배열이 아니라 객체로 옴
}

// 예약 실행 암호: Secrets 의 CRON_SECRET, 없으면 DB 의 chat.app_config('cron_secret')
// (예약 실행 SQL 도 같은 DB 값을 보내므로, 암호를 한 곳에만 두면 됨)
async function cronSecret(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const env = Deno.env.get("CRON_SECRET");
  if (env) return env;
  const { data } = await supabase.schema("chat").from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
  return data?.value ?? null;
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 예약 실행(암호를 아는 쪽)만 허용
  const secret = await cronSecret(supabase);
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  const key = Deno.env.get("HOLIDAY_API_KEY");
  if (!key) return new Response("HOLIDAY_API_KEY 비밀 값이 없어요", { status: 500 });

  const thisYear = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear(); // 한국 시간 기준 연도
  const report: string[] = [];

  for (const year of [thisYear, thisYear + 1]) {
    try {
      // 1) 12개월 모두 받기 (한 달이라도 실패하면 그 해는 건너뜀)
      const items: Item[] = [];
      for (let m = 1; m <= 12; m++) items.push(...(await fetchMonth(key, year, m)));

      // 2) 실제 쉬는 날만 골라 테이블 형식으로 변환 (같은 날 이름이 둘이면 합침)
      const now = new Date().toISOString();
      const byDate = new Map<string, Row>();
      for (const it of items) {
        if (it.isHoliday !== "Y") continue;
        const s = String(it.locdate);
        const date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        const name = String(it.dateName).trim();
        const prev = byDate.get(date);
        if (prev) { if (!prev.name.includes(name)) prev.name += ", " + name; }
        else byDate.set(date, { date, name, source: "api", updated_at: now });
      }
      const rows = [...byDate.values()];

      if (rows.length === 0) {
        report.push(`${year}: 아직 API에 자료가 없어 기존 데이터 유지`);
        continue;
      }

      // 3) 저장 (있으면 덮어쓰기)
      const { error: upErr } = await supabase.from("holidays").upsert(rows, { onConflict: "date" });
      if (upErr) throw upErr;

      // 4) 전에 API로 받았는데 이번엔 없는 날 삭제 (예: 취소된 임시공휴일)
      //    직접 넣은 휴일(manual)과 처음 넣은 휴일(builtin)은 건드리지 않음
      const { error: delErr } = await supabase.from("holidays").delete()
        .gte("date", `${year}-01-01`).lte("date", `${year}-12-31`)
        .eq("source", "api")
        .not("date", "in", `(${rows.map((r) => r.date).join(",")})`);
      if (delErr) throw delErr;

      report.push(`${year}: ${rows.length}일 저장`);
    } catch (e) {
      report.push(`${year}: 실패 - ${e instanceof Error ? e.message : JSON.stringify(e)}`);
    }
  }

  return new Response(JSON.stringify({ report }, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
});
