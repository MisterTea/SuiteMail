package com.suitemail.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;

final class MailNotifications {
    static final String CHANNEL_ID = "default";
    static final String EXTRA_NOTIFICATION_CONTEXT = "suitemail.notification.context";

    private MailNotifications() {}

    static long normalizeTimestampMs(long timestamp) {
        if (timestamp <= 0) return -1L;
        return timestamp < 10_000_000_000L ? timestamp * 1000L : timestamp;
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Default",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Default");
        manager.createNotificationChannel(channel);
    }

    static boolean canPost(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    static void show(
        Context context,
        int id,
        String title,
        String body,
        String largeBody,
        long timestampMs,
        JSObject extra
    ) {
        if (!canPost(context)) return;
        ensureChannel(context);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setDefaults(Notification.DEFAULT_ALL);

        if (largeBody != null && !largeBody.isEmpty()) {
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(largeBody));
        }

        long when = normalizeTimestampMs(timestampMs);
        if (when > 0) {
            builder.setWhen(when);
            builder.setShowWhen(true);
        }

        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(EXTRA_NOTIFICATION_CONTEXT, extra != null ? extra.toString() : "{}");

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder.setContentIntent(pendingIntent);

        NotificationManagerCompat.from(context).notify(id, builder.build());
    }
}
