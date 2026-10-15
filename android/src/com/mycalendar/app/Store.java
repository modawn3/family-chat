package com.mycalendar.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * 앱 화면(웹)과 위젯이 같이 쓰는 저장소.
 *  - 로그인 정보: 웹의 Supabase 로그인 저장소와 같은 곳 (키 이름 그대로)
 *  - snapshot   : 위젯이 그릴 일정·메모·공휴일·날씨 묶음 (JSON)
 *  - month_offset: 위젯에서 보고 있는 달 (이번 달 기준 +- 몇 달)
 */
public final class Store {
    public static final String SUPABASE_URL = "https://qgotxqbmcxulneqdjvav.supabase.co";
    public static final String SUPABASE_KEY = "sb_publishable_wENcAOvX0qM99J4C4zoCPw_A0gGPKiS";
    /** supabase-js 가 로그인 정보를 저장하는 키 이름 */
    public static final String SESSION_KEY = "sb-qgotxqbmcxulneqdjvav-auth-token";

    private static final String PREFS = "calendar_store";
    private static final String WEB_PREFIX = "web:";

    private Store() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* 웹 화면용 저장소 (localStorage 대신) */
    public static synchronized String getWeb(Context c, String key) {
        return prefs(c).getString(WEB_PREFIX + key, null);
    }
    public static synchronized void setWeb(Context c, String key, String value) {
        prefs(c).edit().putString(WEB_PREFIX + key, value).commit();
    }
    public static synchronized void removeWeb(Context c, String key) {
        prefs(c).edit().remove(WEB_PREFIX + key).commit();
    }

    public static String session(Context c) { return getWeb(c, SESSION_KEY); }
    public static void saveSession(Context c, String json) { setWeb(c, SESSION_KEY, json); }

    public static String snapshot(Context c) { return prefs(c).getString("snapshot", null); }
    public static void saveSnapshot(Context c, String json) { prefs(c).edit().putString("snapshot", json).commit(); }

    public static int monthOffset(Context c) { return prefs(c).getInt("month_offset", 0); }
    public static void setMonthOffset(Context c, int v) { prefs(c).edit().putInt("month_offset", v).commit(); }

    public static String lastError(Context c) { return prefs(c).getString("last_error", null); }
    public static void setLastError(Context c, String v) { prefs(c).edit().putString("last_error", v).commit(); }
}
