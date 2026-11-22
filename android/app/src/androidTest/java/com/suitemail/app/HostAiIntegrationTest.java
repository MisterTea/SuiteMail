package com.suitemail.app;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;
import static org.junit.Assume.*;

/** Opt-in: requires a running host Ollama server; never sends mailbox data. */
@RunWith(AndroidJUnit4.class)
public class HostAiIntegrationTest {
    @Test public void emulatorCanReachHostModels() throws Exception {
        assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("hostAiIntegration")));
        assertTrue("Host AI must be enabled for this emulator", SuiteMailPlugin.isEmulator());
        HttpURLConnection connection = (HttpURLConnection) new URL("http://10.0.2.2:11434/v1/models").openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        try {
            assertEquals(200, connection.getResponseCode());
            String json = new String(connection.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(new JSONObject(json).getJSONArray("data").length() > 0);
        } finally { connection.disconnect(); }
    }
}
