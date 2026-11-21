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
        executor.execute(() -> {
            try {
                JSObject envelope = new JSObject(nativeCall(command, args.toString()));
                if (envelope.has("error")) call.reject(envelope.getString("error"));
                else call.resolve(envelope);
            } catch (Exception e) { call.reject("Native call failed", e); }
        });
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

    @Override protected void handleOnDestroy() { executor.shutdownNow(); }
}
