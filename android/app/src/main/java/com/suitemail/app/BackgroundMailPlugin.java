package com.suitemail.app;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.SharedPreferences;

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
        JSObject data=new JSObject();data.put("enabled",BackgroundMailScheduler.enabled(getContext()));
        data.put("intervalMinutes",BackgroundMailScheduler.INTERVAL_MINUTES);data.put("lastAttempt",prefs.getLong("last_attempt",0));
        data.put("lastSuccess",prefs.getLong("last_success",0));data.put("lastError",prefs.getString("last_error",""));
        data.put("queuedThreads",store.count());call.resolve(data);
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
