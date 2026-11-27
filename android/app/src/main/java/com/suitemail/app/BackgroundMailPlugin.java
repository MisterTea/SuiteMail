package com.suitemail.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="BackgroundMail")
public class BackgroundMailPlugin extends Plugin {
    private BackgroundMailStore store;
    private static final java.util.concurrent.ExecutorService scheduledSends=java.util.concurrent.Executors.newSingleThreadExecutor();
    @Override public void load() {
        store=new BackgroundMailStore(getContext());BackgroundMailScheduler.schedule(getContext());
        BackgroundMailScheduler.scheduleBackfill(getContext());
        BackgroundMailScheduler.scheduleScheduledSend(getContext());
    }
    /** WorkManager doesn't run while the app is open, so the app asks the same native sender to run. */
    @PluginMethod public void runDueScheduledSends(PluginCall call) {
        android.content.Context context=getContext().getApplicationContext();
        scheduledSends.execute(() -> {
            ScheduledSender.Result result=ScheduledSender.run(context);
            JSObject data=new JSObject();data.put("sent",result.sent);data.put("failed",result.failed);call.resolve(data);
        });
    }
    @PluginMethod public void configure(PluginCall call) {
        BackgroundMailScheduler.setEnabled(getContext(),call.getBoolean("enabled",true));status(call);
    }
    @PluginMethod public void status(PluginCall call) {
        SharedPreferences prefs=BackgroundMailScheduler.prefs(getContext());
        PowerManager pm=(PowerManager)getContext().getSystemService(android.content.Context.POWER_SERVICE);
        boolean batteryIgnored=Build.VERSION.SDK_INT<Build.VERSION_CODES.M
            || (pm!=null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        JSObject data=new JSObject();data.put("enabled",BackgroundMailScheduler.enabled(getContext()));
        data.put("intervalMinutes",BackgroundMailScheduler.INTERVAL_MINUTES);data.put("lastAttempt",prefs.getLong("last_attempt",0));
        data.put("lastSuccess",prefs.getLong("last_success",0));data.put("lastError",prefs.getString("last_error",""));
        data.put("queuedThreads",store.count());data.put("batteryOptimizationIgnored",batteryIgnored);
        data.put("backfillLastSuccess",prefs.getLong("backfill_last_success",0));
        data.put("backfillLastError",prefs.getString("backfill_last_error",""));
        call.resolve(data);
    }
    @PluginMethod public void requestUnrestrictedBattery(PluginCall call) {
        try {
            Intent intent=new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:"+getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent fallback=new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception err) {
                call.reject("Cannot open battery optimization settings",err);
            }
        }
    }
    @PluginMethod public void pending(PluginCall call) {
        try {JSObject data=new JSObject();data.put("entries",store.list(20));call.resolve(data);}
        catch(Exception e){call.reject("Cannot read downloaded mail",e);}
    }
    @PluginMethod public void acknowledge(PluginCall call) {
        try {JSObject data=new JSObject();data.put("removed",store.acknowledge(call.getString("accountId",""),call.getString("threadId",""),call.getString("version","")));call.resolve(data);}
        catch(Exception e){call.reject("Cannot acknowledge downloaded mail",e);}
    }
}
