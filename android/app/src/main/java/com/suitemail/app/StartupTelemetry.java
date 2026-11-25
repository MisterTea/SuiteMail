package com.suitemail.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class StartupTelemetry {
    private static final String ENDPOINT = "https://suitemail-telemetry.jgmath2000.workers.dev/v1/startup";
    private static final String ENABLED = "enabled";
    private static final int NETWORK_TIMEOUT_MS = 3000;
    private static final int STARTUP_TIMEOUT_MS = 30_000;
    private static StartupTelemetry instance;

    static synchronized StartupTelemetry forProcess(Context context) {
        if (instance == null) instance = new StartupTelemetry(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private final SharedPreferences preferences;
    private final boolean optedInAtLaunch;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable startupTimeout = () -> record(false);
    private boolean completed;
    private boolean recorded;
    private HttpsURLConnection pending;

    private StartupTelemetry(Context context) {
        this.context = context;
        preferences = context.getSharedPreferences("startup_telemetry", Context.MODE_PRIVATE);
        boolean debuggable = (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        optedInAtLaunch = !debuggable && isEnabled();
        if (optedInAtLaunch) handler.postDelayed(startupTimeout, STARTUP_TIMEOUT_MS);
    }

    boolean isEnabled() {
        return preferences.getBoolean(ENABLED, false);
    }

    boolean setEnabled(boolean enabled) {
        HttpsURLConnection connection;
        synchronized (this) {
            if (!preferences.edit().putBoolean(ENABLED, enabled).commit()) {
                throw new IllegalStateException("Could not save the startup diagnostics setting");
            }
            connection = pending;
        }
        if (!enabled && connection != null) connection.disconnect();
        return enabled;
    }

    synchronized boolean finishStartup(boolean hasConfiguredAccounts, boolean succeeded) {
        if (completed) return false;
        completed = true;
        record(succeeded);
        return hasConfiguredAccounts && !preferences.contains(ENABLED);
    }

    synchronized void record(boolean succeeded) {
        if (recorded) return;
        recorded = true;
        handler.removeCallbacks(startupTimeout);
        if (!optedInAtLaunch || !isEnabled()) return;
        new Thread(() -> send(succeeded), "SuiteMail startup diagnostics").start();
    }

    private void send(boolean succeeded) {
        HttpsURLConnection connection = null;
        try {
            PackageManager manager = context.getPackageManager();
            String version = manager.getPackageInfo(context.getPackageName(), 0).versionName;
            byte[] body = new JSONObject()
                .put("version", version)
                .put("platform", "android")
                .put("result", succeeded ? "ready" : "failed")
                .toString().getBytes(StandardCharsets.UTF_8);

            connection = (HttpsURLConnection) new URL(ENDPOINT).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(NETWORK_TIMEOUT_MS);
            connection.setReadTimeout(NETWORK_TIMEOUT_MS);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            synchronized (this) {
                if (!isEnabled()) return;
                pending = connection;
            }
            try (OutputStream output = connection.getOutputStream()) {
                if (!isEnabled()) return;
                output.write(body);
            }
            connection.getResponseCode();
        } catch (Exception ignored) {
            // Diagnostics are best effort and must never interrupt startup.
        } finally {
            if (connection != null) connection.disconnect();
            synchronized (this) { pending = null; }
        }
    }
}
