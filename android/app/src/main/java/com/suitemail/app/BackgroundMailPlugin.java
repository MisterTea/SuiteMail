package com.suitemail.app;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.SharedPreferences;

@CapacitorPlugin(name="BackgroundMail")
public class BackgroundMailPlugin extends Plugin {
    private BackgroundMailStore store;
    @Override public void load() { store=new BackgroundMailStore(getContext());BackgroundMailScheduler.schedule(getContext()); }
    @PluginMethod public void configure(PluginCall call) {
        BackgroundMailScheduler.setEnabled(getContext(),call.getBoolean("enabled",true));status(call);
    }
    @PluginMethod public void status(PluginCall call) {
        SharedPreferences prefs=BackgroundMailScheduler.prefs(getContext());
        JSObject data=new JSObject();data.put("enabled",BackgroundMailScheduler.enabled(getContext()));
        data.put("intervalMinutes",15);data.put("lastAttempt",prefs.getLong("last_attempt",0));
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
