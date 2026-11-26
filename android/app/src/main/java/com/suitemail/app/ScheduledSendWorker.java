package com.suitemail.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** WorkManager entry point for scheduled mail. Runs whether or not the app is open or background sync is enabled. */
public class ScheduledSendWorker extends Worker {
    public ScheduledSendWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }
    @NonNull @Override public Result doWork() {
        ScheduledSender.Result result = ScheduledSender.run(getApplicationContext());
        // Deferred rows (e.g. no network for Gmail) stay pending for the next periodic run.
        return Result.success();
    }
}
