package com.mycalendar.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** 홈 화면 월간 달력 위젯 */
public class CalendarWidget extends AppWidgetProvider {

    static final String ACTION_PREV = "com.mycalendar.app.PREV";
    static final String ACTION_NEXT = "com.mycalendar.app.NEXT";
    static final String ACTION_TODAY = "com.mycalendar.app.TODAY";
    static final String ACTION_REFRESH = "com.mycalendar.app.REFRESH";

    /* ---------- 시스템이 30분마다 부름 ---------- */
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        renderAll(context, null);
        refreshInBackground(context, goAsync());
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (ACTION_PREV.equals(a)) {
            Store.setMonthOffset(context, Store.monthOffset(context) - 1);
            renderAll(context, null);
        } else if (ACTION_NEXT.equals(a)) {
            Store.setMonthOffset(context, Store.monthOffset(context) + 1);
            renderAll(context, null);
        } else if (ACTION_TODAY.equals(a)) {
            Store.setMonthOffset(context, 0);
            renderAll(context, null);
        } else if (ACTION_REFRESH.equals(a)) {
            renderAll(context, "새로 불러오는 중…");
            refreshInBackground(context, goAsync());
        } else {
            super.onReceive(context, intent);
        }
    }

    static void refreshInBackground(final Context context, final PendingResult pending) {
        final Context app = context.getApplicationContext();
        new Thread(new Runnable() {
            public void run() {
                int r = Api.refresh(app);
                renderAll(app, r == Api.NOT_LOGGED_IN ? "앱을 열어 로그인해 주세요" : r == Api.NETWORK_ERROR ? "연결 오류 · ⟳ 로 다시 시도" : null);
                if (pending != null) pending.finish();
            }
        }).start();
    }

    /** 앱에서 저장했을 때 등, 지금 자료로 다시 그리기 */
    public static void renderAll(Context context, String notice) {
        AppWidgetManager m = AppWidgetManager.getInstance(context);
        int[] ids = m.getAppWidgetIds(new ComponentName(context, CalendarWidget.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews v = build(context, notice);
        for (int id : ids) m.updateAppWidget(id, v);
    }

    /* ---------- 그리기 ---------- */
    static final int[] CELL = new int[42], DAY = new int[42], WX = new int[42], ITEMS = new int[42];
    static final int[] ROW = new int[6];

    static void ids(Context c) {
        if (ROW[0] != 0) return;
        String pkg = c.getPackageName();
        for (int r = 0; r < 6; r++) {
            ROW[r] = c.getResources().getIdentifier("row_" + r, "id", pkg);
            for (int k = 0; k < 7; k++) {
                CELL[r * 7 + k] = c.getResources().getIdentifier("cell_" + r + "_" + k, "id", pkg);
                DAY[r * 7 + k] = c.getResources().getIdentifier("day_" + r + "_" + k, "id", pkg);
                WX[r * 7 + k] = c.getResources().getIdentifier("wx_" + r + "_" + k, "id", pkg);
                ITEMS[r * 7 + k] = c.getResources().getIdentifier("items_" + r + "_" + k, "id", pkg);
            }
        }
    }

    static String ymd(Calendar d) {
        return String.format(Locale.US, "%04d-%02d-%02d", d.get(Calendar.YEAR), d.get(Calendar.MONTH) + 1, d.get(Calendar.DAY_OF_MONTH));
    }

    /* ---------- 음력 (한국 음력 dangi, 없으면 chinese) ---------- */
    static android.icu.util.Calendar LUNAR;

    static android.icu.util.Calendar lunarCal() {
        if (LUNAR != null) return LUNAR;
        for (String ca : new String[]{"dangi", "chinese"}) {
            try {
                android.icu.util.Calendar l = android.icu.util.Calendar.getInstance(new android.icu.util.ULocale("ko_KR@calendar=" + ca));
                if (ca.equals(l.getType())) { LUNAR = l; return l; }
            } catch (Exception ignored) {}
        }
        return null;
    }

    /** "9.5", 윤달은 "윤6.1". 계산할 수 없으면 null */
    static String lunar(Calendar d) {
        android.icu.util.Calendar l = lunarCal();
        if (l == null) return null;
        try {
            Calendar noon = (Calendar) d.clone();
            noon.set(Calendar.HOUR_OF_DAY, 12);
            l.setTimeInMillis(noon.getTimeInMillis());
            boolean leap = l.get(android.icu.util.Calendar.IS_LEAP_MONTH) == 1;
            return (leap ? "윤" : "") + (l.get(android.icu.util.Calendar.MONTH) + 1) + "." + l.get(android.icu.util.Calendar.DAY_OF_MONTH);
        } catch (Exception e) {
            return null;
        }
    }

    static String wxSymbol(String code) {
        if (code == null) return "";
        switch (code) {
            case "clear": return "☀";
            case "partly": return "⛅";
            case "cloudy": return "☁";
            case "rain": return "☂";
            case "shower": return "☔";
            case "sleet": return "☂❄";
            case "snow": return "❄";
            default: return "";
        }
    }

    static int catColor(Context c, String cat) {
        if ("work".equals(cat)) return c.getColor(R.color.c_work);
        if ("personal".equals(cat)) return c.getColor(R.color.c_personal);
        return c.getColor(R.color.c_etc);
    }

    static class Item { String time; String title; String cat; boolean memo; }

    static RemoteViews build(Context c, String notice) {
        ids(c);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_calendar);

        int ink = c.getColor(R.color.w_ink), muted = c.getColor(R.color.w_muted), faint = c.getColor(R.color.w_faint);
        int holidayColor = c.getColor(R.color.w_holiday), satColor = c.getColor(R.color.w_saturday), accent = c.getColor(R.color.w_accent);

        // 자료 읽기
        Map<String, List<Item>> byDate = new HashMap<String, List<Item>>();
        JSONObject holidays = new JSONObject(), weather = new JSONObject();
        boolean hasData = false;
        try {
            String raw = Store.snapshot(c);
            if (raw != null) {
                hasData = true;
                JSONObject s = new JSONObject(raw);
                JSONArray ev = s.optJSONArray("events");
                for (int i = 0; ev != null && i < ev.length(); i++) {
                    JSONObject o = ev.getJSONObject(i);
                    Item it = new Item();
                    it.time = o.isNull("start_time") ? "" : o.optString("start_time", "");
                    it.title = o.optString("title", "");
                    it.cat = o.optString("cat", "etc");
                    add(byDate, o.optString("date"), it);
                }
                JSONArray me = s.optJSONArray("memos");
                for (int i = 0; me != null && i < me.length(); i++) {
                    JSONObject o = me.getJSONObject(i);
                    if (o.isNull("date")) continue;
                    Item it = new Item();
                    it.memo = true;
                    it.time = "";
                    String t = o.isNull("title") ? "" : o.optString("title", "");
                    if (t.length() == 0) {
                        String b = o.isNull("body") ? "" : o.optString("body", "");
                        t = b.split("\n")[0];
                    }
                    it.title = t.length() == 0 ? "메모" : t;
                    it.cat = o.optString("cat", "etc");
                    add(byDate, o.optString("date"), it);
                }
                JSONObject h = s.optJSONObject("holidays");
                if (h != null) holidays = h;
                JSONObject w = s.optJSONObject("weather");
                if (w != null) weather = w;
            }
        } catch (Exception ignored) {}

        // 보여줄 달
        Calendar month = Calendar.getInstance();
        month.set(Calendar.DAY_OF_MONTH, 1);
        month.add(Calendar.MONTH, Store.monthOffset(c));
        int year = month.get(Calendar.YEAR), mon = month.get(Calendar.MONTH);
        v.setTextViewText(R.id.title, year + "년 " + (mon + 1) + "월");

        String today = ymd(Calendar.getInstance());
        Calendar d = (Calendar) month.clone();
        d.add(Calendar.DAY_OF_MONTH, -(month.get(Calendar.DAY_OF_WEEK) - 1));
        int daysInMonth = month.getActualMaximum(Calendar.DAY_OF_MONTH);
        int weeks = (int) Math.ceil((month.get(Calendar.DAY_OF_WEEK) - 1 + daysInMonth) / 7.0);

        for (int r = 0; r < 6; r++) {
            v.setViewVisibility(ROW[r], r < weeks ? View.VISIBLE : View.GONE);
            for (int k = 0; k < 7; k++) {
                String key = ymd(d);
                boolean inMonth = d.get(Calendar.MONTH) == mon;
                String hol = holidays.optString(key, null);
                if (hol != null && hol.length() == 0) hol = null;

                // 날짜 숫자
                int dayColor = !inMonth ? faint : (hol != null || k == 0) ? holidayColor : k == 6 ? satColor : ink;
                SpannableStringBuilder dn = new SpannableStringBuilder(String.valueOf(d.get(Calendar.DAY_OF_MONTH)));
                String lu = lunar(d);
                if (lu != null) {
                    int s0 = dn.length();
                    dn.append(" ").append(lu);
                    dn.setSpan(new ForegroundColorSpan(inMonth ? muted : faint), s0, dn.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    dn.setSpan(new RelativeSizeSpan(0.72f), s0, dn.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    dn.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.NORMAL), s0, dn.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
                v.setTextViewText(DAY[r * 7 + k], dn);
                v.setTextColor(DAY[r * 7 + k], key.equals(today) ? accent : dayColor);
                v.setInt(CELL[r * 7 + k], "setBackgroundResource", key.equals(today) ? R.drawable.cell_today : R.drawable.cell_plain);

                // 날씨
                JSONObject w = weather.optJSONObject(key);
                String wx = "";
                if (w != null) {
                    wx = wxSymbol(w.optString("code"));
                }
                v.setTextViewText(WX[r * 7 + k], wx);

                // 공휴일 + 일정 + 메모
                SpannableStringBuilder sb = new SpannableStringBuilder();
                if (hol != null && inMonth) {
                    int s0 = sb.length();
                    sb.append(hol.replace(" 연휴", "").replace("대체공휴일", "대체휴일"));
                    sb.setSpan(new ForegroundColorSpan(holidayColor), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    sb.setSpan(new RelativeSizeSpan(0.92f), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
                List<Item> items = byDate.get(key);
                if (items != null) {
                    int shown = 0;
                    for (Item it : items) {
                        if (shown == 3) {
                            if (sb.length() > 0) sb.append("\n");
                            int s0 = sb.length();
                            sb.append("+").append(String.valueOf(items.size() - 3));
                            sb.setSpan(new ForegroundColorSpan(muted), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                            break;
                        }
                        if (sb.length() > 0) sb.append("\n");
                        int s0 = sb.length();
                        sb.append(it.memo ? "▫" : "▪");
                        sb.setSpan(new ForegroundColorSpan(catColor(c, it.cat)), s0, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        int s1 = sb.length();
                        sb.append(it.title);
                        sb.setSpan(new ForegroundColorSpan(inMonth ? (it.memo ? muted : ink) : faint), s1, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                        shown++;
                    }
                }
                v.setTextViewText(ITEMS[r * 7 + k], sb);

                // 날짜 누르면 앱이 그 날짜로 열림
                Intent open = new Intent(c, MainActivity.class);
                open.setAction("open-date:" + key);
                open.putExtra("date", key);
                open.putExtra("action", "open");
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent pi = PendingIntent.getActivity(c, 100 + r * 7 + k, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                v.setOnClickPendingIntent(CELL[r * 7 + k], pi);

                d.add(Calendar.DAY_OF_MONTH, 1);
            }
        }

        // 위쪽 버튼
        v.setOnClickPendingIntent(R.id.btn_prev, broadcast(c, ACTION_PREV, 1));
        v.setOnClickPendingIntent(R.id.btn_next, broadcast(c, ACTION_NEXT, 2));
        v.setOnClickPendingIntent(R.id.btn_today, broadcast(c, ACTION_TODAY, 3));
        v.setOnClickPendingIntent(R.id.btn_refresh, broadcast(c, ACTION_REFRESH, 4));
        Intent add = new Intent(c, MainActivity.class);
        add.setAction("add-today");
        add.putExtra("date", today);
        add.putExtra("action", "add");
        add.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.btn_add, PendingIntent.getActivity(c, 5, add, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        Intent app = new Intent(c, MainActivity.class);
        app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.title, PendingIntent.getActivity(c, 6, app, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        // 안내 문구
        String msg = notice;
        if (msg == null && !hasData) msg = "앱을 열어 로그인해 주세요";
        if (msg != null) {
            v.setTextViewText(R.id.notice, msg);
            v.setViewVisibility(R.id.notice, View.VISIBLE);
            v.setOnClickPendingIntent(R.id.notice, PendingIntent.getActivity(c, 7, app, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        } else {
            v.setViewVisibility(R.id.notice, View.GONE);
        }
        return v;
    }

    static void add(Map<String, List<Item>> map, String date, Item it) {
        if (date == null || date.length() == 0) return;
        List<Item> l = map.get(date);
        if (l == null) { l = new ArrayList<Item>(); map.put(date, l); }
        l.add(it);
        // 일정(시간순) 먼저, 메모는 뒤로
        Collections.sort(l, new Comparator<Item>() {
            public int compare(Item a, Item b) {
                if (a.memo != b.memo) return a.memo ? 1 : -1;
                String ta = a.time.length() == 0 ? "99" : a.time, tb = b.time.length() == 0 ? "99" : b.time;
                return ta.compareTo(tb);
            }
        });
    }

    static PendingIntent broadcast(Context c, String action, int code) {
        Intent i = new Intent(c, CalendarWidget.class);
        i.setAction(action);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
