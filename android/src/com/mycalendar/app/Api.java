package com.mycalendar.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** 위젯이 앱을 열지 않고도 Supabase 에서 최신 자료를 받아오는 부분 */
public final class Api {
    private Api() {}

    public static final int OK = 0, NOT_LOGGED_IN = 1, NETWORK_ERROR = 2;

    /** 로그인 정보로 최신 자료를 받아 snapshot 에 저장 */
    public static synchronized int refresh(Context c) {
        try {
            String access = validAccessToken(c);
            if (access == null) return NOT_LOGGED_IN;

            JSONArray events = get(access, "/rest/v1/events?select=id,date,title,start_time,cat&order=date");
            JSONArray memos = get(access, "/rest/v1/memos?select=id,date,title,body,cat&date=not.is.null");
            JSONArray holidays = get(access, "/rest/v1/holidays?select=date,name");
            JSONArray weather = get(access, "/rest/v1/weather?select=date,code,tmin,tmax");

            JSONObject snap = new JSONObject();
            snap.put("events", events);
            snap.put("memos", memos);
            JSONObject h = new JSONObject();
            for (int i = 0; i < holidays.length(); i++) {
                JSONObject o = holidays.getJSONObject(i);
                h.put(o.getString("date"), o.getString("name"));
            }
            snap.put("holidays", h);
            JSONObject w = new JSONObject();
            for (int i = 0; i < weather.length(); i++) {
                JSONObject o = weather.getJSONObject(i);
                w.put(o.getString("date"), o);
            }
            snap.put("weather", w);
            snap.put("updated", System.currentTimeMillis());
            Store.saveSnapshot(c, snap.toString());
            Store.setLastError(c, null);
            return OK;
        } catch (AuthException e) {
            return NOT_LOGGED_IN;
        } catch (Exception e) {
            Store.setLastError(c, "network");
            return NETWORK_ERROR;
        }
    }

    static class AuthException extends Exception {}

    /** 저장된 로그인 정보에서 유효한 접근 토큰을 꺼냄. 만료가 가까우면 갱신해서 다시 저장 */
    private static String validAccessToken(Context c) throws Exception {
        String raw = Store.session(c);
        if (raw == null || raw.length() == 0 || "null".equals(raw)) return null;
        JSONObject s = new JSONObject(raw);
        // 일부 버전은 { currentSession: {...} } 형태로 저장
        if (s.has("currentSession")) s = s.getJSONObject("currentSession");
        String access = s.optString("access_token", null);
        String refreshToken = s.optString("refresh_token", null);
        long expiresAt = s.optLong("expires_at", 0);
        long now = System.currentTimeMillis() / 1000;
        if (access != null && expiresAt - now > 120) return access;
        if (refreshToken == null) return null;

        JSONObject body = new JSONObject();
        body.put("refresh_token", refreshToken);
        HttpURLConnection con = open("/auth/v1/token?grant_type=refresh_token", null);
        con.setRequestMethod("POST");
        con.setDoOutput(true);
        con.setRequestProperty("Content-Type", "application/json");
        OutputStream os = con.getOutputStream();
        os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        os.close();
        int code = con.getResponseCode();
        if (code == 400 || code == 401 || code == 403) throw new AuthException();
        if (code != 200) throw new Exception("token " + code);
        JSONObject fresh = new JSONObject(read(con.getInputStream()));
        if (!fresh.has("expires_at") && fresh.has("expires_in")) {
            fresh.put("expires_at", now + fresh.getLong("expires_in"));
        }
        // 웹 화면이 다음에 읽을 수 있게 같은 형태로 저장
        Store.saveSession(c, fresh.toString());
        return fresh.getString("access_token");
    }

    private static JSONArray get(String access, String path) throws Exception {
        HttpURLConnection con = open(path, access);
        int code = con.getResponseCode();
        if (code == 401) throw new AuthException();
        if (code != 200) throw new Exception(path + " " + code);
        return new JSONArray(read(con.getInputStream()));
    }

    private static HttpURLConnection open(String path, String access) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(Store.SUPABASE_URL + path).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(20000);
        con.setRequestProperty("apikey", Store.SUPABASE_KEY);
        if (access != null) con.setRequestProperty("Authorization", "Bearer " + access);
        con.setRequestProperty("Accept", "application/json");
        return con;
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}
