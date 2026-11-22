package com.suitemail.app;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.work.*;
import java.util.concurrent.TimeUnit;

public final class BackgroundMailScheduler {
    static final String NAME = "suitemail-periodic-gmail";
    static final String TAG = "suitemail-background-mail";
    static volatile boolean foreground = false;
    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("background_mail", Context.MODE_PRIVATE);
    }
    static boolean enabled(Context context) { return prefs(context).getBoolean("enabled", true); }
    static Constraints constraints() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build();
    }
    static void schedule(Context context) {
        if (!enabled(context)) return;
        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(BackgroundMailWorker.class,15,TimeUnit.MINUTES)
            .setInitialDelay(15,TimeUnit.MINUTES).setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.LINEAR,30,TimeUnit.SECONDS).addTag(TAG).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME,ExistingPeriodicWorkPolicy.KEEP,work);
    }
    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean("enabled",enabled).commit();
        if (enabled) schedule(context);
        else WorkManager.getInstance(context).cancelAllWorkByTag(TAG);
    }
}
