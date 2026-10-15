package com.mycalendar.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * 일정·할 일 알림.
 *  - 내 달력에서 고른 remind(몇 분 전, 없으면 알림 안 함)를 보고 휴대폰 안에서 시간 맞춰 알림을 띄움 (서버 필요 없음)
 *  - 시간이 없는 일정과 할 일(마감일)은 그날 오전 9시 기준
 *  - 다음 알림 하나만 AlarmManager 에 맞춰 두고, 울리면 그다음 것을 다시 맞춤
 *  - 30분마다 서버에서 새 자료를 받아 다시 맞춤 (다른 기기에서 고친 것 반영)
 */
public final class Reminders {
    private Reminders() {}

    static final String CHANNEL = "reminders";
    static final String ACTION_FIRE = "com.mycalendar.app.REMIND";
    static final String ACTION_SYNC = "com.mycalendar.app.REMIND_SYNC";
    static final int BASE_HOUR = 9;                  // 시간 없는 일정·할 일의 기준 시각
    static final long LATE_LIMIT = 2 * 3600 * 1000L; // 휴대폰이 꺼져 있었으면 2시간 이내 것만 늦게라도 알림
    static final long CATCH_UP = 5 * 60 * 1000L;     // 방금 지난(5분 이내) 알림은 바로 알림

    static class Item {
        String key, title, date, time, kind;
        int remind;
        long at;
    }

    /** snapshot 에서 알림이 있는 일정·할 일을 모두 꺼냄 */
    static List<Item> items(Context c) {
        List<Item> out = new ArrayList<Item>();
        String raw = Store.snapshot(c);
        if (raw == null) return out;
        try {
            JSONObject snap = new JSONObject(raw);
            JSONArray ev = snap.optJSONArray("events");
            if (ev != null) for (int i = 0; i < ev.length(); i++) {
                JSONObject o = ev.getJSONObject(i);
                if (o.isNull("remind") || !o.has("remind")) continue;
                Item it = new Item();
                it.kind = "event";
                it.key = "e:" + o.optString("id") + ":" + o.optString("date");
                it.title = o.optString("title", "");
                it.date = o.optString("date", "");
                it.time = o.isNull("start_time") ? "" : o.optString("start_time", "");
                it.remind = o.optInt("remind", 0);
                it.at = fireAt(it.date, it.time, it.remind);
                if (it.at > 0) out.add(it);
            }
            JSONArray td = snap.optJSONArray("todos");
            if (td != null) for (int i = 0; i < td.length(); i++) {
                JSONObject o = td.getJSONObject(i);
                if (o.optBoolean("done", false) || o.isNull("due") || o.isNull("remind") || !o.has("remind")) continue;
                Item it = new Item();
                it.kind = "todo";
                it.key = "t:" + o.optString("id") + ":" + o.optString("due");
                it.title = o.optString("title", "");
                it.date = o.optString("due", "");
                it.time = "";
                it.remind = o.optInt("remind", 0);
                it.at = fireAt(it.date, "", it.remind);
                if (it.at > 0) out.add(it);
            }
        } catch (Exception ignored) {}
        return out;
    }

    /** "2026-10-15" + "14:30"(없으면 오전 9시) - remind 분 → 알림 시각(ms) */
    static long fireAt(String date, String time, int remind) {
        try {
            String[] d = date.split("-");
            int h = BASE_HOUR, m = 0;
            if (time != null && time.length() >= 4) {
                String[] t = time.split(":");
                h = Integer.parseInt(t[0].trim());
                m = Integer.parseInt(t[1].trim());
            }
            Calendar cal = Calendar.getInstance();
            cal.clear();
            cal.set(Integer.parseInt(d[0]), Integer.parseInt(d[1]) - 1, Integer.parseInt(d[2]), h, m, 0);
            return cal.getTimeInMillis() - remind * 60000L;
        } catch (Exception e) {
            return -1;
        }
    }

    static SharedPreferences prefs(Context c) { return Store.prefs(c); }

    /** 다음 알림 시각을 맞춤 (자료가 바뀔 때마다 부름) */
    public static synchronized void schedule(Context c) {
        c = c.getApplicationContext();
        long now = System.currentTimeMillis();
        long last = prefs(c).getLong("remind_last", 0);
        if (last < now - CATCH_UP) {
            last = now - CATCH_UP;
            prefs(c).edit().putLong("remind_last", last).commit();
        }
        long next = Long.MAX_VALUE;
        for (Item it : items(c)) if (it.at > last && it.at < next) next = it.at;

        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent fire = broadcast(c, ACTION_FIRE, 1);
        if (next == Long.MAX_VALUE) {
            am.cancel(fire);
        } else {
            long when = Math.max(next, now + 1000);
            boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, fire);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, fire);
        }
        // 30분마다 서버에서 새 자료 받기 (로그인돼 있을 때만 의미 있음)
        am.setInexactRepeating(AlarmManager.RTC, now + AlarmManager.INTERVAL_HALF_HOUR,
                AlarmManager.INTERVAL_HALF_HOUR, broadcast(c, ACTION_SYNC, 2));
    }

    /** 알림 시각이 됨: 지금까지 울려야 할 것을 모두 알리고 다음 것을 맞춤 */
    public static synchronized void fire(Context c) {
        c = c.getApplicationContext();
        long now = System.currentTimeMillis();
        long last = prefs(c).getLong("remind_last", 0);
        long from = Math.max(last, now - LATE_LIMIT);
        long until = now + 30 * 1000L;               // 30초 안에 울릴 것도 함께
        for (Item it : items(c)) if (it.at > from && it.at <= until) show(c, it);
        prefs(c).edit().putLong("remind_last", until).commit();
        schedule(c);
    }

    /** 로그아웃: 알림 모두 끄기 */
    public static void clear(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(broadcast(c, ACTION_FIRE, 1));
        am.cancel(broadcast(c, ACTION_SYNC, 2));
    }

    static PendingIntent broadcast(Context c, String action, int code) {
        Intent i = new Intent(c, ReminderReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void ensureChannel(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "일정·할 일 알림", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("내 달력에서 알림을 고른 일정과 할 일");
        nm.createNotificationChannel(ch);
    }

    static void show(Context c, Item it) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannel(c);
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("date", it.date);
        open.putExtra("action", "todo".equals(it.kind) ? "todo" : "open");
        int id = it.key.hashCode();
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String title = "todo".equals(it.kind) ? "할 일 · " + it.title : it.title;
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(whenText(it))
                .setCategory("todo".equals(it.kind) ? Notification.CATEGORY_REMINDER : Notification.CATEGORY_EVENT)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setWhen(it.at)
                .setShowWhen(true)
                .build();
        try { nm.notify(id, n); } catch (SecurityException ignored) {}
    }

    /** "오늘 14:30", "내일 (종일)", "10월 20일까지" */
    static String whenText(Item it) {
        String day;
        try {
            String[] d = it.date.split("-");
            Calendar target = Calendar.getInstance();
            target.clear();
            target.set(Integer.parseInt(d[0]), Integer.parseInt(d[1]) - 1, Integer.parseInt(d[2]));
            Calendar today = Calendar.getInstance();
            Calendar t0 = Calendar.getInstance();
            t0.clear();
            t0.set(today.get(Calendar.YEAR), today.get(Calendar.MONTH), today.get(Calendar.DAY_OF_MONTH));
            long diff = Math.round((target.getTimeInMillis() - t0.getTimeInMillis()) / 86400000.0);
            if (diff == 0) day = "오늘";
            else if (diff == 1) day = "내일";
            else if (diff == 2) day = "모레";
            else day = Integer.parseInt(d[1]) + "월 " + Integer.parseInt(d[2]) + "일";
        } catch (Exception e) {
            day = it.date;
        }
        if ("todo".equals(it.kind)) return day + "까지";
        return it.time.length() > 0 ? day + " " + it.time.substring(0, Math.min(5, it.time.length())) : day + " (종일)";
    }
}
