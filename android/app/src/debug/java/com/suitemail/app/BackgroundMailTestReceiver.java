package com.suitemail.app;
import android.content.*;
import androidx.work.*;
/** Debug-only trigger for testing the real headless worker without waiting 15 minutes. */
public class BackgroundMailTestReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(intent.getBooleanExtra("scheduled_send",false)){
            // Debug builds only: point the scheduled sender at a local test server instead of Gmail.
            android.content.SharedPreferences.Editor edit=BackgroundMailScheduler.prefs(context).edit();
            if(intent.hasExtra("send_url"))edit.putString(ScheduledSender.DEBUG_SEND_URL,intent.getStringExtra("send_url"));
            if(intent.hasExtra("access_token"))edit.putString(ScheduledSender.DEBUG_ACCESS_TOKEN,intent.getStringExtra("access_token"));
            if(intent.getBooleanExtra("clear_debug",false))edit.remove(ScheduledSender.DEBUG_SEND_URL).remove(ScheduledSender.DEBUG_ACCESS_TOKEN);
            edit.commit();
            if(intent.getBooleanExtra("configure_only",false))return;
            OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(ScheduledSendWorker.class).build();
            WorkManager.getInstance(context).enqueueUniqueWork("suitemail-scheduled-send-test",ExistingWorkPolicy.REPLACE,work);
            return;
        }
        if(intent.hasExtra("gmail_url") || intent.hasExtra("gmail_token") || intent.getBooleanExtra("clear_gmail_debug",false)){
            // Debug builds only: point the background fetch at a local Gmail stand-in.
            android.content.SharedPreferences.Editor edit=BackgroundMailScheduler.prefs(context).edit();
            if(intent.hasExtra("gmail_url"))edit.putString(BackgroundMailWorker.DEBUG_GMAIL_URL,intent.getStringExtra("gmail_url"));
            if(intent.hasExtra("gmail_token"))edit.putString(BackgroundMailWorker.DEBUG_ACCESS_TOKEN,intent.getStringExtra("gmail_token"));
            if(intent.getBooleanExtra("clear_gmail_debug",false))edit.remove(BackgroundMailWorker.DEBUG_GMAIL_URL).remove(BackgroundMailWorker.DEBUG_ACCESS_TOKEN);
            edit.commit();
            if(intent.getBooleanExtra("configure_only",false))return;
        }
        if(intent.getBooleanExtra("bootstrap",false)){
            android.content.SharedPreferences prefs=BackgroundMailScheduler.prefs(context);
            android.content.SharedPreferences.Editor edit=prefs.edit();
            for(String key:prefs.getAll().keySet())if(key.startsWith("state:"))edit.remove(key);
            edit.commit(); // Replay only the worker's derived bootstrap; never touch account/mail databases.
        }
        OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(BackgroundMailWorker.class)
            .setConstraints(BackgroundMailScheduler.constraints()).addTag(BackgroundMailScheduler.TAG).build();
        WorkManager.getInstance(context).enqueueUniqueWork("suitemail-background-test",ExistingWorkPolicy.REPLACE,work);
    }
}
