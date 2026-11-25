package com.suitemail.app;

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
}
