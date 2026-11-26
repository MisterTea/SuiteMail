package com.suitemail.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

final class MailNotifications {
    static final String CHANNEL_ID = "default";
    static final String EXTRA_NOTIFICATION_CONTEXT = "suitemail.notification.context";
    static final String EXTRA_NOTIFICATION_ID = "suitemail.notification.id";
    static final String EXTRA_NOTIFICATION_GROUP = "suitemail.notification.group";

    static final String ACTION_ARCHIVE = "com.suitemail.app.action.NOTIFICATION_ARCHIVE";
    static final String ACTION_MARK_READ = "com.suitemail.app.action.NOTIFICATION_MARK_READ";
    static final String ACTION_REPLY = "com.suitemail.app.action.NOTIFICATION_REPLY";
    static final String KEY_REPLY_TEXT = "suitemail.notification.reply_text";

    private static final String PREFS_NAME = "suitemail_notification_actions";
    private static final String PREFS_PENDING_KEY = "pending_actions";
    private static final int MAX_SMART_REPLIES = 3;
    private static final int MAX_SMART_REPLY_LENGTH = 200;
    private static final int MAX_PENDING_ACTIONS = 50;

    static final int SLOT_OPEN = 0;
    static final int SLOT_ARCHIVE = 1;
    static final int SLOT_MARK_READ = 2;
    static final int SLOT_REPLY = 3;

    private MailNotifications() {}

    static long normalizeTimestampMs(long timestamp) {
        if (timestamp <= 0) return -1L;
        return timestamp < 10_000_000_000L ? timestamp * 1000L : timestamp;
    }

    static int requestCode(int notificationId, int slot) {
        return notificationId * 4 + (slot & 3);
    }

    static boolean hasThreadContext(JSONObject extra) {
        if (extra == null) return false;
        String accountId = extra.optString("accountId", "").trim();
        String threadId = extra.optString("threadId", "").trim();
        return !accountId.isEmpty() && !threadId.isEmpty();
    }

    static CharSequence[] normalizeSmartReplies(List<String> replies) {
        if (replies == null || replies.isEmpty()) return new CharSequence[0];
        Set<String> unique = new LinkedHashSet<>();
        for (String reply : replies) {
            if (reply == null) continue;
            String cleaned = reply.replaceAll("\\s+", " ").trim();
            if (cleaned.isEmpty()) continue;
            if (cleaned.length() > MAX_SMART_REPLY_LENGTH) {
                cleaned = cleaned.substring(0, MAX_SMART_REPLY_LENGTH).trim();
            }
            unique.add(cleaned);
            if (unique.size() >= MAX_SMART_REPLIES) break;
        }
        return unique.toArray(new CharSequence[0]);
    }

    static List<String> extractSmartReplies(JSArray raw) {
        List<String> replies = new ArrayList<>();
        if (raw == null) return replies;
        for (int i = 0; i < raw.length(); i++) {
            Object item = raw.opt(i);
            if (item instanceof String) {
                replies.add((String) item);
            }
        }
        return replies;
    }

    static String mapIntentAction(String intentAction) {
        if (ACTION_ARCHIVE.equals(intentAction)) return "archive";
        if (ACTION_MARK_READ.equals(intentAction)) return "mark_read";
        if (ACTION_REPLY.equals(intentAction)) return "reply";
        return null;
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
        String group,
        String groupTitle,
        JSObject extra
    ) {
        show(context, id, title, body, largeBody, timestampMs, group, groupTitle, extra, null);
    }

    static void show(
        Context context,
        int id,
        String title,
        String body,
        String largeBody,
        long timestampMs,
        String group,
        String groupTitle,
        JSObject extra,
        List<String> smartReplies
    ) {
        if (!canPost(context)) return;
        ensureChannel(context);

        String extraJson = extra != null ? extra.toString() : "{}";
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
        boolean grouped = group != null && !group.isEmpty();
        if (grouped) builder.setGroup(group);

        long when = normalizeTimestampMs(timestampMs);
        if (when > 0) {
            builder.setWhen(when);
            builder.setShowWhen(true);
        }

        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(EXTRA_NOTIFICATION_CONTEXT, extraJson);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            requestCode(id, SLOT_OPEN),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder.setContentIntent(pendingIntent);

        if (hasThreadContext(extra)) {
            addThreadActions(context, builder, id, group, extraJson, normalizeSmartReplies(smartReplies));
        }

        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        manager.notify(id, builder.build());
        if (grouped) {
            Notification summary = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle(groupTitle != null ? groupTitle : context.getString(R.string.app_name))
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setShowWhen(false)
                .setGroup(group)
                .setGroupSummary(true)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
                .build();
            manager.notify(group, 0, summary);
        }
    }

    private static void addThreadActions(
        Context context,
        NotificationCompat.Builder builder,
        int notificationId,
        String group,
        String extraJson,
        CharSequence[] choices
    ) {
        PendingIntent archiveIntent = PendingIntent.getBroadcast(
            context,
            requestCode(notificationId, SLOT_ARCHIVE),
            actionIntent(context, ACTION_ARCHIVE, notificationId, group, extraJson),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder.addAction(
            new NotificationCompat.Action.Builder(0, context.getString(R.string.notification_action_archive), archiveIntent)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_ARCHIVE)
                .setShowsUserInterface(false)
                .build()
        );

        PendingIntent markReadIntent = PendingIntent.getBroadcast(
            context,
            requestCode(notificationId, SLOT_MARK_READ),
            actionIntent(context, ACTION_MARK_READ, notificationId, group, extraJson),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder.addAction(
            new NotificationCompat.Action.Builder(0, context.getString(R.string.notification_action_mark_read), markReadIntent)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                .setShowsUserInterface(false)
                .build()
        );

        int replyFlags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent replyIntent = PendingIntent.getBroadcast(
            context,
            requestCode(notificationId, SLOT_REPLY),
            actionIntent(context, ACTION_REPLY, notificationId, group, extraJson),
            replyFlags
        );
        RemoteInput.Builder remoteInput = new RemoteInput.Builder(KEY_REPLY_TEXT)
            .setLabel(context.getString(R.string.notification_action_reply_hint))
            .setAllowFreeFormInput(true);
        if (choices.length > 0) {
            remoteInput.setChoices(choices);
        }
        builder.addAction(
            new NotificationCompat.Action.Builder(0, context.getString(R.string.notification_action_reply), replyIntent)
                .addRemoteInput(remoteInput.build())
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .setAllowGeneratedReplies(choices.length == 0)
                .build()
        );
    }

    private static Intent actionIntent(
        Context context,
        String action,
        int notificationId,
        String group,
        String extraJson
    ) {
        Intent intent = new Intent(context, MailNotificationActionReceiver.class);
        intent.setAction(action);
        intent.putExtra(EXTRA_NOTIFICATION_ID, notificationId);
        if (group != null && !group.isEmpty()) {
            intent.putExtra(EXTRA_NOTIFICATION_GROUP, group);
        }
        intent.putExtra(EXTRA_NOTIFICATION_CONTEXT, extraJson);
        return intent;
    }

    static void cancelNotification(Context context, int notificationId, String group) {
        NotificationManagerCompat compat = NotificationManagerCompat.from(context);
        if (notificationId >= 0) {
            compat.cancel(notificationId);
        }
        if (group == null || group.isEmpty()) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        int remainingChildren = 0;
        for (StatusBarNotification active : manager.getActiveNotifications()) {
            Notification notification = active.getNotification();
            if (notification == null) continue;
            if (!group.equals(notification.getGroup())) continue;
            boolean isSummary = (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0;
            if (!isSummary && active.getId() != notificationId) {
                remainingChildren++;
            }
        }
        if (remainingChildren == 0) {
            compat.cancel(group, 0);
        }
    }

    static synchronized JSObject enqueuePendingAction(
        Context context,
        String action,
        String contextJson,
        String replyText
    ) {
        JSObject payload = new JSObject();
        payload.put("id", UUID.randomUUID().toString());
        payload.put("action", action);
        if (replyText != null) {
            payload.put("replyText", replyText);
        }
        try {
            payload.put("context", contextJson != null && !contextJson.isEmpty() ? new JSObject(contextJson) : new JSObject());
        } catch (Exception ignored) {
            payload.put("context", new JSObject());
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONArray queue = readQueue(prefs);
        queue.put(payload);
        while (queue.length() > MAX_PENDING_ACTIONS) {
            queue.remove(0);
        }
        prefs.edit().putString(PREFS_PENDING_KEY, queue.toString()).commit();
        return payload;
    }

    static synchronized JSArray readPendingActions(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONArray queue = readQueue(prefs);
        JSArray result = new JSArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item == null) continue;
            try {
                result.put(new JSObject(item.toString()));
            } catch (Exception ignored) {}
        }
        return result;
    }

    static synchronized void acknowledgePendingAction(Context context, String actionId) {
        if (actionId == null || actionId.isEmpty()) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONArray queue = readQueue(prefs);
        JSONArray updated = new JSONArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && !actionId.equals(item.optString("id", ""))) {
                updated.put(item);
            }
        }
        prefs.edit().putString(PREFS_PENDING_KEY, updated.toString()).commit();
    }

    private static JSONArray readQueue(SharedPreferences prefs) {
        String raw = prefs.getString(PREFS_PENDING_KEY, "[]");
        try {
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }
}
