package com.suitemail.app;
import android.content.*;
import androidx.work.*;
/** Debug-only trigger for testing the real headless worker without waiting 15 minutes. */
public class BackgroundMailTestReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
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
