package com.suitemail.app;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "SuiteMail")
public class SuiteMailPlugin extends Plugin {
    static { System.loadLibrary("supermail_android"); }
    private static native String nativeCall(String command, String arguments);
    private static volatile WeakReference<SuiteMailPlugin> activeInstance = new WeakReference<>(null);
    private OAuthLoginDialog oauthLogin;
    private StartupTelemetry startupTelemetry;
    private final AiCoreBridge aiCore = new AiCoreBridge();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    private static final Object DATABASE = new Object();
    private static volatile boolean databaseReady = false;

    private static void initDatabase(android.content.Context context) throws Exception {
        synchronized (DATABASE) {
            if (databaseReady) return;
            JSObject args = new JSObject();
            args.put("path", context.getFilesDir().getAbsolutePath() + "/suitemail.db");
            JSObject result = new JSObject(nativeCall("db_init", args.toString()));
            if (result.has("error")) throw new IllegalStateException(result.getString("error"));
            databaseReady = true;
        }
    }

    /**
     * Raw database command on the app's own Rust connection, initializing it first when WorkManager
     * cold-started this process without the WebView. Use AppDatabase instead of calling this directly.
     */
    static String databaseCall(android.content.Context context, String command, String args) throws Exception {
        initDatabase(context);
        return nativeCall(command, args);
    }

    @Override public void load() {
        activeInstance = new WeakReference<>(this);
        startupTelemetry = StartupTelemetry.forProcess(getContext());
        try {
            initDatabase(getContext());
        } catch (Exception e) {
            startupTelemetry.record(false);
            throw new IllegalStateException("Cannot initialize SuiteMail database", e);
        }
        if (getActivity() != null) {
            deliverNotificationIntent(getActivity().getIntent());
        }
    }

    @Override protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        deliverNotificationIntent(intent);
    }

    private void deliverNotificationIntent(Intent intent) {
        if (intent == null || !intent.hasExtra(MailNotifications.EXTRA_NOTIFICATION_CONTEXT)) return;
        String raw = intent.getStringExtra(MailNotifications.EXTRA_NOTIFICATION_CONTEXT);
        intent.removeExtra(MailNotifications.EXTRA_NOTIFICATION_CONTEXT);
        try {
            JSObject context = raw != null && !raw.isEmpty() ? new JSObject(raw) : new JSObject();
            notifyListeners("mailNotificationOpened", context, true);
        } catch (Exception e) {
            Logger.error("SuiteMail", "Could not parse mail notification context", e);
        }
    }

    static void deliverNotificationAction(JSObject payload) {
        SuiteMailPlugin plugin = activeInstance.get();
        if (plugin != null && payload != null) {
            plugin.notifyListeners("mailNotificationAction", payload, true);
        }
    }

    @PluginMethod public void showNotification(PluginCall call) {
        int id = call.getInt("id", (int) (System.currentTimeMillis() % 1_000_000_000L));
        String title = call.getString("title", "SuiteMail");
        String body = call.getString("body", "");
        String largeBody = call.getString("largeBody");
        long timestamp = call.getData().optLong("timestamp", -1L);
        String group = call.getString("group");
        String groupTitle = call.getString("groupTitle");
        JSObject extra = call.getObject("extra", new JSObject());
        JSArray smartRepliesRaw = call.getArray("smartReplies");
        List<String> smartReplies = MailNotifications.extractSmartReplies(smartRepliesRaw);
        try {
            MailNotifications.show(getContext(), id, title, body, largeBody, timestamp, group, groupTitle, extra, smartReplies);
            call.resolve();
        } catch (Exception e) {
            call.reject("Cannot show mail notification", e);
        }
    }

    @PluginMethod public void getPendingNotificationActions(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("actions", MailNotifications.readPendingActions(getContext()));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Cannot read pending notification actions", e);
        }
    }

    @PluginMethod public void acknowledgeNotificationAction(PluginCall call) {
        String id = call.getString("id", "");
        try {
            MailNotifications.acknowledgePendingAction(getContext(), id);
            call.resolve();
        } catch (Exception e) {
            call.reject("Cannot acknowledge notification action", e);
        }
    }

    @PluginMethod public void invoke(PluginCall call) {
        String command = call.getString("command");
        if (command == null) { call.reject("Missing command"); return; }
        JSObject args = call.getObject("args", new JSObject());
        if ("android_device_info".equals(command)) {
            JSObject info = new JSObject();
            info.put("isEmulator", isEmulator());
            JSObject result = new JSObject();
            result.put("value", info);
            call.resolve(result);
            return;
        }
        if ("oauth_webview_login".equals(command)) {
            getActivity().runOnUiThread(() -> {
                if (oauthLogin != null) { call.reject("Finish the current sign-in first."); return; }
                String authUrl = args.getString("authUrl", "");
                String redirect = args.getString("redirectPrefix", "");
                String state = args.getString("state", "");
                Uri auth = Uri.parse(authUrl);
                // This window is for Microsoft public-client authentication only.
                if (!"https".equals(auth.getScheme()) || !"login.microsoftonline.com".equals(auth.getHost())
                    || !"https://login.microsoftonline.com/common/oauth2/nativeclient".equals(redirect)
                    || state.isEmpty() || !state.equals(auth.getQueryParameter("state"))
                    || !redirect.equals(auth.getQueryParameter("redirect_uri"))) {
                    call.reject("Invalid Microsoft sign-in request."); return;
                }
                try {
                    oauthLogin = new OAuthLoginDialog(getActivity(), call, authUrl, redirect, state,
                        () -> oauthLogin = null);
                } catch (Exception e) { call.reject("Cannot open Microsoft sign-in.", e); }
            });
            return;
        }
        executor.execute(() -> {
            try {
                if (command.equals("close_splashscreen") || command.equals("get_startup_telemetry") || command.equals("set_startup_telemetry")) {
                    boolean value;
                    if (command.equals("close_splashscreen")) {
                        value = startupTelemetry.finishStartup(
                            Boolean.TRUE.equals(args.opt("hasConfiguredAccounts")),
                            Boolean.TRUE.equals(args.opt("startupSucceeded"))
                        );
                    } else if (command.equals("get_startup_telemetry")) {
                        value = startupTelemetry.isEnabled();
                    } else {
                        if (!(args.opt("enabled") instanceof Boolean)) throw new IllegalArgumentException("Expected a telemetry consent boolean");
                        value = startupTelemetry.setEnabled(args.getBoolean("enabled"));
                    }
                    JSObject result = new JSObject();
                    result.put("value", value);
                    call.resolve(result);
                    return;
                }
                if (command.equals("aicore_is_available") || command.equals("aicore_generate") || command.equals("aicore_prepare")) {
                    JSObject result = new JSObject();
                    result.put("value", aiCore.invoke(command, args, getContext()));
                    call.resolve(result);
                    return;
                }
                if (command.equals("proton_available")) {
                    JSObject result = new JSObject();
                    result.put("value", !Logger.shouldLog() && ProtonBridge.isAvailable());
                    call.resolve(result);
                    return;
                }
                if (command.equals("proton_login") || command.equals("proton_remove") || command.equals("proton_status")) {
                    JSObject result = new JSObject();
                    result.put("value", ProtonBridge.invoke(getContext(), command.substring(7), args));
                    call.resolve(result);
                    return;
                }
                boolean isProtonImap = false;
                if (command.startsWith("imap_") || command.startsWith("smtp_")) {
                    JSObject config = args.getJSObject("config");
                    if (config != null && ProtonBridge.ACCOUNT_HOST.equals(config.optString("host"))) {
                        isProtonImap = true;
                        ProtonBridge.configure(getContext(), config, command.startsWith("smtp_"));
                        args.put("config", config);
                    }
                }
                JSObject envelope = new JSObject(nativeCall(command, args.toString()));
                if (envelope.has("error")) {
                    String err = envelope.getString("error");
                    if (command.startsWith("imap_") || command.startsWith("smtp_") || command.startsWith("proton_")) {
                        android.util.Log.w("SuiteMailImap", command + (isProtonImap ? " [proton]" : "") + " failed: " + err);
                    }
                    call.reject(err);
                } else {
                    if (isProtonImap) {
                        String extra = "";
                        if ("imap_delta_check".equals(command)) {
                            org.json.JSONArray arr = envelope.optJSONArray("value");
                            int folders = arr == null ? 0 : arr.length();
                            int newUids = 0;
                            if (arr != null) {
                                for (int i = 0; i < arr.length(); i++) {
                                    org.json.JSONObject item = arr.optJSONObject(i);
                                    org.json.JSONArray nu = item == null ? null : item.optJSONArray("new_uids");
                                    if (nu != null) newUids += nu.length();
                                }
                            }
                            extra = " (folders=" + folders + ", new_uids=" + newUids + ")";
                        }
                        android.util.Log.i("SuiteMailImap", command + " [proton] ok" + extra);
                    }
                    call.resolve(envelope);
                }
            } catch (Exception e) {
                Throwable cause = e.getCause() != null ? e.getCause() : e;
                String msg = cause.getMessage() != null ? cause.getMessage() : "Native call failed";
                if (command.startsWith("imap_") || command.startsWith("smtp_") || command.startsWith("proton_")) {
                    android.util.Log.w("SuiteMailImap", command + " threw: " + msg, cause);
                }
                call.reject(msg, e);
            }
        });
    }

    static boolean isEmulator() {
        return android.os.Build.FINGERPRINT.startsWith("generic")
            || android.os.Build.FINGERPRINT.contains("emulator")
            || android.os.Build.MODEL.contains("Emulator")
            || android.os.Build.MODEL.contains("Android SDK built for")
            || android.os.Build.PRODUCT.contains("sdk")
            || android.os.Build.HARDWARE.contains("goldfish")
            || android.os.Build.HARDWARE.contains("ranchu");
    }

    @PluginMethod public void openUrl(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("url", ""));
            String scheme = uri.getScheme();
            if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme)) {
                call.reject("Unsupported URL scheme"); return;
            }
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri));
            call.resolve();
        } catch (Exception e) { call.reject("Cannot open URL", e); }
    }

    @Override protected void handleOnDestroy() {
        if (activeInstance.get() == this) {
            activeInstance = new WeakReference<>(null);
        }
        if (oauthLogin != null) getActivity().runOnUiThread(() -> {
            if (oauthLogin != null) oauthLogin.cancel();
        });
        executor.shutdownNow();
    }
}
