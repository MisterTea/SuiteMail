package com.suitemail.app;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class MailNotificationsTest {
    @Test public void normalizesValidTimestampsToMilliseconds() {
        assertEquals(1704067200000L, MailNotifications.normalizeTimestampMs(1704067200000L));
        assertEquals(1704067200000L, MailNotifications.normalizeTimestampMs(1704067200L));
    }

    @Test public void rejectsMissingOrNonPositiveTimestamps() {
        assertEquals(-1L, MailNotifications.normalizeTimestampMs(0L));
        assertEquals(-1L, MailNotifications.normalizeTimestampMs(-500L));
    }

    @Test public void detectsThreadContextForNotificationActions() throws Exception {
        assertTrue(MailNotifications.hasThreadContext(
            new JSONObject().put("accountId", "acc-1").put("threadId", "thread-1")
        ));
        assertFalse(MailNotifications.hasThreadContext(
            new JSONObject().put("accountId", "acc-1")
        ));
        assertFalse(MailNotifications.hasThreadContext(
            new JSONObject().put("accountId", "acc-1").put("threadId", "   ")
        ));
        assertFalse(MailNotifications.hasThreadContext(null));
    }

    @Test public void normalizesAndCapsSmartReplies() {
        CharSequence[] normalized = MailNotifications.normalizeSmartReplies(Arrays.asList(
            "  Sounds good!  ",
            "",
            null,
            "Sounds   good!",
            "I'll take a look\ntomorrow.",
            "Thanks for the update.",
            "Fourth option ignored"
        ));
        assertEquals(3, normalized.length);
        assertEquals("Sounds good!", normalized[0].toString());
        assertEquals("I'll take a look tomorrow.", normalized[1].toString());
        assertEquals("Thanks for the update.", normalized[2].toString());
        assertEquals(0, MailNotifications.normalizeSmartReplies(Collections.emptyList()).length);
        assertEquals(0, MailNotifications.normalizeSmartReplies(null).length);
    }

    @Test public void mapsIntentActionsAndGeneratesUniqueRequestCodes() {
        assertEquals("archive", MailNotifications.mapIntentAction(MailNotifications.ACTION_ARCHIVE));
        assertEquals("mark_read", MailNotifications.mapIntentAction(MailNotifications.ACTION_MARK_READ));
        assertEquals("reply", MailNotifications.mapIntentAction(MailNotifications.ACTION_REPLY));
        assertNull(MailNotifications.mapIntentAction("com.suitemail.app.action.UNKNOWN"));
        assertNull(MailNotifications.mapIntentAction(null));

        Set<Integer> codes = new HashSet<>();
        for (int id = 10; id <= 12; id++) {
            codes.add(MailNotifications.requestCode(id, MailNotifications.SLOT_OPEN));
            codes.add(MailNotifications.requestCode(id, MailNotifications.SLOT_ARCHIVE));
            codes.add(MailNotifications.requestCode(id, MailNotifications.SLOT_MARK_READ));
            codes.add(MailNotifications.requestCode(id, MailNotifications.SLOT_REPLY));
        }
        assertEquals(12, codes.size());
    }
}
