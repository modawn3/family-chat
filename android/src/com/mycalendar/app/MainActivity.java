package com.mycalendar.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.WebResourceError;
import android.widget.Toast;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;

/**
 * 앱 화면: 가족 채팅 사이트의 「내 달력」(my/)을 그대로 띄우고, 위젯·알림과 자료를 주고받음.
 * (1.4.0 부터 앱 안 화면 대신 사이트를 띄움 → 화면을 고칠 때 APK 를 다시 만들 필요 없음)
 */
public class MainActivity extends Activity {
    static final String HOST = "app.local";                 // 예전 앱 안 화면(assets/www) 주소
    static final String SITE = "modawn3.github.io";
    static final String SITE_PATH = "/family-chat/my/";
    static final String START = "https://" + SITE + SITE_PATH;

    WebView web;
    String launchDate, launchAction;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.length() == 0) path = "/index.html";
                try {
                    InputStream in = getAssets().open("www" + path);
                    WebResourceResponse r = new WebResourceResponse(mime(path), "utf-8", in);
                    HashMap<String, String> h = new HashMap<String, String>();
                    h.put("Cache-Control", "no-cache");
                    r.setResponseHeaders(h);
                    return r;
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                // 인터넷이 안 될 때: 다시 시도 안내 (위젯·알림은 받아 둔 자료로 계속 동작)
                view.loadDataWithBaseURL(null,
                        "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                        + "<body style='font-family:sans-serif;text-align:center;padding:60px 24px;color:#444'>"
                        + "<h3>인터넷에 연결할 수 없어요</h3><p>연결을 확인한 뒤 다시 시도해 주세요.</p>"
                        + "<p><a href='" + START + "' style='display:inline-block;padding:10px 20px;background:#3B4BA8;color:#fff;border-radius:8px;text-decoration:none'>다시 시도</a></p>"
                        + "</body></html>", "text/html", "utf-8", null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                String path = u.getPath() == null ? "" : u.getPath();
                if (SITE.equals(u.getHost()) && (path + "/").startsWith(SITE_PATH)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        takeIntent(getIntent());
        web.loadUrl(START);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeIntent(intent);
        if (web != null) web.evaluateJavascript("window.onAndroidLaunch && window.onAndroidLaunch()", null);
    }

    void takeIntent(Intent i) {
        if (i == null) return;
        String d = i.getStringExtra("date");
        if (d != null) {
            launchDate = d;
            launchAction = i.getStringExtra("action");
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        CalendarWidget.renderAll(this, null);
    }

    @Override
    public void onBackPressed() {
        // 웹 화면의 열린 창(입력·세부)을 먼저 닫고, 없으면 앱을 뒤로
        web.evaluateJavascript("window.onAndroidBack ? window.onAndroidBack() : false", new android.webkit.ValueCallback<String>() {
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) MainActivity.super.onBackPressed();
            }
        });
    }

    static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    /** 웹 화면에서 window.AndroidBridge 로 부르는 함수들 */
    class Bridge {
        @JavascriptInterface public String getItem(String key) { return Store.getWeb(MainActivity.this, key); }
        @JavascriptInterface public void setItem(String key, String value) { Store.setWeb(MainActivity.this, key, value); }
        @JavascriptInterface public void removeItem(String key) { Store.removeWeb(MainActivity.this, key); }

        /** 위젯에서 눌러 열린 경우 {date, action} 을 한 번만 돌려줌 */
        @JavascriptInterface public String takeLaunch() {
            if (launchDate == null) return "null";
            try {
                JSONObject o = new JSONObject();
                o.put("date", launchDate);
                o.put("action", launchAction == null ? "open" : launchAction);
                launchDate = null; launchAction = null;
                return o.toString();
            } catch (Exception e) { return "null"; }
        }

        /** 웹 화면이 자료를 불러오거나 저장한 뒤 부름 → 위젯 즉시 다시 그리기 + 알림 다시 맞추기 */
        @JavascriptInterface public void dataChanged(String snapshotJson) {
            Store.saveSnapshot(MainActivity.this, snapshotJson);
            CalendarWidget.renderAll(MainActivity.this, null);
            Reminders.schedule(MainActivity.this);
            // 다른 기기에서 알림을 골라 둔 경우: 처음 한 번만 알림 권한을 물어봄
            if (!Reminders.items(MainActivity.this).isEmpty()) askPermission(false);
        }

        /** 내 달력에서 알림을 고르고 저장했을 때 */
        @JavascriptInterface public void askNotifyPermission() { askPermission(true); }

        /** 로그아웃 */
        @JavascriptInterface public void loggedOut() {
            Store.prefs(MainActivity.this).edit().remove("snapshot").commit();
            CalendarWidget.renderAll(MainActivity.this, null);
            Reminders.clear(MainActivity.this);
        }
    }

    /** 알림 권한 (안드로이드 13 이상은 물어봐야 함). userAction: 사용자가 방금 알림을 골랐음 */
    void askPermission(final boolean userAction) {
        runOnUiThread(new Runnable() {
            public void run() {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                boolean granted = Build.VERSION.SDK_INT < 33
                        ? nm == null || nm.areNotificationsEnabled()
                        : checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED
                          && (nm == null || nm.areNotificationsEnabled());
                if (granted) return;
                boolean askedBefore = Store.prefs(MainActivity.this).getBoolean("notify_asked", false);
                if (Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
                        && (!askedBefore || shouldShowRequestPermissionRationale("android.permission.POST_NOTIFICATIONS"))) {
                    Store.prefs(MainActivity.this).edit().putBoolean("notify_asked", true).commit();
                    requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, 1);
                    return;
                }
                if (!userAction) return;
                // 예전에 거절했거나 설정에서 꺼 둔 경우: 설정 화면으로 안내
                Toast.makeText(MainActivity.this, "알림을 받으려면 「알림 허용」을 켜 주세요", Toast.LENGTH_LONG).show();
                try {
                    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    i.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    startActivity(i);
                } catch (Exception ignored) {}
            }
        });
    }
}
