package com.mycalendar.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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

/** 앱 화면: 달력 메모장 웹 화면을 그대로 띄우고, 위젯과 자료를 주고받음 */
public class MainActivity extends Activity {
    static final String HOST = "app.local";
    static final String START = "https://" + HOST + "/index.html";

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
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
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

        /** 웹 화면이 자료를 불러오거나 저장한 뒤 부름 → 위젯 즉시 다시 그리기 */
        @JavascriptInterface public void dataChanged(String snapshotJson) {
            Store.saveSnapshot(MainActivity.this, snapshotJson);
            CalendarWidget.renderAll(MainActivity.this, null);
        }

        /** 로그아웃 */
        @JavascriptInterface public void loggedOut() {
            Store.prefs(MainActivity.this).edit().remove("snapshot").commit();
            CalendarWidget.renderAll(MainActivity.this, null);
        }
    }
}
