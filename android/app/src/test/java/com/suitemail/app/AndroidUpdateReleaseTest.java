package com.suitemail.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class AndroidUpdateReleaseTest {
    private JSONObject release(String version) throws Exception {
        return new JSONObject().put("tag_name", "v" + version).put("assets", new JSONArray().put(
            new JSONObject().put("state", "uploaded").put("name", "SuiteMail-" + version + "-android.apk")
                .put("browser_download_url", "https://github.com/MisterTea/SuiteMail/releases/download/v" + version + "/SuiteMail-" + version + "-android.apk")));
    }
    @Test public void comparesVersionsNumerically() {
        assertTrue(AndroidUpdateRelease.versionCode("0.10.0") > AndroidUpdateRelease.versionCode("0.9.99"));
        assertEquals(1001, AndroidUpdateRelease.versionCode("0.1.0"));
        assertEquals(-1, AndroidUpdateRelease.versionCode("0.2.0-beta"));
        assertEquals(-1, AndroidUpdateRelease.versionCode("0.1000.0"));
        assertEquals(-1, AndroidUpdateRelease.versionCode("999999999999999999999.0.0"));
    }
    @Test public void picksHighestEligibleVersionRegardlessOfOrder() throws Exception {
        JSONArray releases = new JSONArray().put(release("0.2.0")).put(release("0.10.0")).put(release("0.3.0"));
        assertEquals("0.10.0", AndroidUpdateRelease.select(releases, 1001, null).version);
    }
    @Test public void ignoresDraftPrereleaseMissingAndUntrustedAssets() throws Exception {
        JSONArray releases = new JSONArray().put(release("0.2.0").put("draft", true))
            .put(release("0.3.0").put("prerelease", true)).put(release("0.4.0").put("assets", new JSONArray()));
        JSONObject untrusted = release("0.5.0");
        untrusted.getJSONArray("assets").getJSONObject(0).put("browser_download_url", "https://example.com/app.apk");
        releases.put(untrusted).put(release("0.1.0"));
        assertNull(AndroidUpdateRelease.select(releases, 1001, null));
    }
    @Test public void preservesHigherCandidateAcrossPages() throws Exception {
        AndroidUpdateRelease best = AndroidUpdateRelease.select(new JSONArray().put(release("0.5.0")), 1001, null);
        assertSame(best, AndroidUpdateRelease.select(new JSONArray().put(release("0.2.0")), 1001, best));
    }
}
