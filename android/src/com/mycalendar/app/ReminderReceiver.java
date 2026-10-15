package com.mycalendar.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 알림 시각, 30분마다 새 자료 받기, 휴대폰 재시작·시간 변경·앱 업데이트 때 알림 다시 맞추기 */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        final String a = intent.getAction();
        if (Reminders.ACTION_FIRE.equals(a)) {
            Reminders.fire(app);
            return;
        }
        // 그 밖(30분마다, 재시작, 시간 변경, 앱 업데이트): 서버에서 새로 받아 다시 맞춤
        final PendingResult pending = goAsync();
        new Thread(new Runnable() {
            public void run() {
                try {
                    if (Api.refresh(app) == Api.OK) CalendarWidget.renderAll(app, null);
                    else Reminders.schedule(app);
                } finally {
                    pending.finish();
                }
            }
        }).start();
    }
}
