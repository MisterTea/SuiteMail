package com.suitemail.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import com.getcapacitor.JSObject;

public class MailNotificationActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = MailNotifications.mapIntentAction(intent.getAction());
        if (action == null) return;

        int notificationId = intent.getIntExtra(MailNotifications.EXTRA_NOTIFICATION_ID, -1);
        String group = intent.getStringExtra(MailNotifications.EXTRA_NOTIFICATION_GROUP);
        String contextJson = intent.getStringExtra(MailNotifications.EXTRA_NOTIFICATION_CONTEXT);

        String replyText = null;
        if ("reply".equals(action)) {
            Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
            CharSequence input = remoteInput != null ? remoteInput.getCharSequence(MailNotifications.KEY_REPLY_TEXT) : null;
            replyText = input != null ? input.toString().trim() : "";
            if (replyText.isEmpty()) {
                return;
            }
        }

        MailNotifications.cancelNotification(context, notificationId, group);
        JSObject payload = MailNotifications.enqueuePendingAction(context, action, contextJson, replyText);
        SuiteMailPlugin.deliverNotificationAction(payload);
    }
}
