package com.suitemail.app;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "SuiteMail")
public class SuiteMailPlugin extends Plugin {
    static { System.loadLibrary("supermail_android"); }
    private static native String nativeCall(String command, String arguments);
    private OAuthLoginDialog oauthLogin;
    private final AiCoreBridge aiCore = new AiCoreBridge();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @Override public void load() {
        String path = getContext().getFilesDir().getAbsolutePath() + "/suitemail.db";
        JSObject args = new JSObject();
        args.put("path", path);
        try {
            JSObject result = new JSObject(nativeCall("db_init", args.toString()));
            if (result.has("error")) throw new IllegalStateException(result.getString("error"));
        } catch (Exception e) {
            throw new IllegalStateException("Cannot initialize SuiteMail database", e);
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
                if (command.equals("aicore_is_available") || command.equals("aicore_generate") || command.equals("aicore_prepare")) {
                    JSObject result = new JSObject();
                    result.put("value", aiCore.invoke(command, args));
                    call.resolve(result);
                    return;
                }
                JSObject envelope = new JSObject(nativeCall(command, args.toString()));
                if (envelope.has("error")) call.reject(envelope.getString("error"));
                else call.resolve(envelope);
            } catch (Exception e) {
                Throwable cause = e.getCause() != null ? e.getCause() : e;
                call.reject(cause.getMessage() != null ? cause.getMessage() : "Native call failed", e);
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
        if (oauthLogin != null) getActivity().runOnUiThread(() -> {
            if (oauthLogin != null) oauthLogin.cancel();
        });
        executor.shutdownNow();
    }
}
