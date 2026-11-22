package com.suitemail.app;

import org.json.JSONArray;
import org.json.JSONObject;

/** Pure release selection shared by the updater and JVM tests. */
final class AndroidUpdateRelease {
    final String version, body, url;
    final long code;

    AndroidUpdateRelease(String version, String body, String url, long code) {
        this.version = version; this.body = body; this.url = url; this.code = code;
    }

    static long versionCode(String version) {
        if (!version.matches("[0-9]+\\.[0-9]+\\.[0-9]+")) return -1;
        try {
            String[] parts = version.split("\\.");
            long major = Long.parseLong(parts[0]), minor = Long.parseLong(parts[1]), patch = Long.parseLong(parts[2]);
            if (major > 2146 || minor > 999 || patch > 999) return -1;
            return 1 + major * 1000000 + minor * 1000 + patch;
        } catch (NumberFormatException e) { return -1; }
    }

    static AndroidUpdateRelease select(JSONArray releases, long installed, AndroidUpdateRelease best) throws Exception {
        for (int i = 0; i < releases.length(); i++) {
            JSONObject release = releases.getJSONObject(i);
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) continue;
            String tag = release.optString("tag_name");
            if (!tag.startsWith("v")) continue;
            String version = tag.substring(1);
            long code = versionCode(version);
            if (code <= installed || (best != null && code <= best.code)) continue;
            JSONArray assets = release.optJSONArray("assets");
            if (assets == null) continue;
            String expected = "SuiteMail-" + version + "-android.apk";
            for (int j = 0; j < assets.length(); j++) {
                JSONObject asset = assets.getJSONObject(j);
                String url = asset.optString("browser_download_url");
                if (expected.equals(asset.optString("name")) && "uploaded".equals(asset.optString("state"))
                    && url.startsWith("https://github.com/MisterTea/SuiteMail/releases/download/" + tag + "/")) {
                    best = new AndroidUpdateRelease(version, release.optString("body", ""), url, code);
                    break;
                }
            }
        }
        return best;
    }
}
