package com.suitemail.app;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class OAuthLoginDialogTest {
    private static final String REDIRECT = "https://login.microsoftonline.com/common/oauth2/nativeclient";

    @Test public void matchesExactReplyEndpointOnly() {
        assertTrue(OAuthLoginDialog.matchesRedirect(REDIRECT + "?code=abc&state=nonce", REDIRECT));
        assertFalse(OAuthLoginDialog.matchesRedirect(REDIRECT + "/other?code=abc", REDIRECT));
        assertFalse(OAuthLoginDialog.matchesRedirect(REDIRECT.replace(".com/", ".com.evil.test/"), REDIRECT));
        assertFalse(OAuthLoginDialog.matchesRedirect(REDIRECT.replace("https:", "http:"), REDIRECT));
        assertFalse(OAuthLoginDialog.matchesRedirect("https://evil.test/?next=" + REDIRECT, REDIRECT));
    }
    @Test public void returnsCodeAndMatchingState() {
        assertEquals("a+b", OAuthLoginDialog.parseReply(REDIRECT + "?code=a%2Bb&state=nonce", "nonce").getString("code"));
        assertEquals("nonce", OAuthLoginDialog.parseReply(REDIRECT + "?code=abc&state=nonce", "nonce").getString("state"));
    }
    @Test(expected = IllegalArgumentException.class) public void rejectsWrongState() {
        OAuthLoginDialog.parseReply(REDIRECT + "?code=abc&state=other", "nonce");
    }
    @Test(expected = IllegalArgumentException.class) public void rejectsMissingState() {
        OAuthLoginDialog.parseReply(REDIRECT + "?code=abc", "nonce");
    }
    @Test(expected = IllegalArgumentException.class) public void rejectsMissingCode() {
        OAuthLoginDialog.parseReply(REDIRECT + "?state=nonce", "nonce");
    }
    @Test public void reportsProviderErrors() {
        try {
            OAuthLoginDialog.parseReply(REDIRECT + "?state=nonce&error=access_denied&error_description=Permission%20denied", "nonce");
            fail("Expected Microsoft error");
        } catch (IllegalArgumentException e) { assertEquals("Permission denied", e.getMessage()); }
    }
}
