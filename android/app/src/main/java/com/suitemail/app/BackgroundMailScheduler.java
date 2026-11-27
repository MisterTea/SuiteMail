package com.suitemail.app;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.work.*;
import java.util.concurrent.TimeUnit;

public final class BackgroundMailScheduler {
    static final String NAME = "suitemail-periodic-gmail";
    static final String TAG = "suitemail-background-mail";
    static final String BACKFILL_NAME = "suitemail-gmail-backfill";
    static final String BACKFILL_TAG = "suitemail-gmail-backfill";
    static final int INTERVAL_MINUTES = 30;
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
        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(BackgroundMailWorker.class, INTERVAL_MINUTES, TimeUnit.MINUTES)
            .setInitialDelay(INTERVAL_MINUTES, TimeUnit.MINUTES).setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS).addTag(TAG).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, work);
    }
    static final String SCHEDULED_SEND = "suitemail-scheduled-send";
    /** Scheduled mail must go out even when background sync is off or the battery is low, so it has its own job. */
    static void scheduleScheduledSend(Context context) {
        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(ScheduledSendWorker.class,15,TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(SCHEDULED_SEND,ExistingPeriodicWorkPolicy.KEEP,work);
    }
    static void scheduleBackfill(Context context) {
        if (!enabled(context)) return;
        OneTimeWorkRequest work = new OneTimeWorkRequest.Builder(BackgroundBackfillWorker.class)
            .setConstraints(constraints())
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
            .addTag(BACKFILL_TAG)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork(BACKFILL_NAME, ExistingWorkPolicy.KEEP, work);
    }
    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean("enabled",enabled).commit();
        if (enabled) {
            schedule(context);
            scheduleBackfill(context);
        } else {
            WorkManager.getInstance(context).cancelAllWorkByTag(TAG);
            WorkManager.getInstance(context).cancelAllWorkByTag(BACKFILL_TAG);
        }
    }
}
