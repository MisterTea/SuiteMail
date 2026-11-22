package com.suitemail.app;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import com.getcapacitor.JSObject;
import com.google.mlkit.genai.prompt.ModelPreference;
import com.google.mlkit.genai.prompt.ModelReleaseStage;
import com.google.mlkit.genai.common.FeatureStatus;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AiCoreBridgeTest {
    @Test public void requestsFullStableModel() {
        assertEquals(ModelPreference.FULL, AiCoreBridge.fullConfiguration().getModelConfig().getPreference());
        assertEquals(ModelReleaseStage.STABLE, AiCoreBridge.fullConfiguration().getModelConfig().getReleaseStage());
    }
    @Test public void downloadRequiredDoesNotReportReady() throws Exception {
        JSObject status = AiCoreBridge.describe(FeatureStatus.DOWNLOADABLE);
        assertFalse(status.getBoolean("available"));
        assertEquals("downloadable", status.getString("status"));
    }
    @Test public void checksActualDeviceSupportWithoutDownloading() throws Exception {
        JSObject status = (JSObject) new AiCoreBridge().invoke("aicore_is_available", new JSObject());
        assertNotNull(status.getString("status"));
        assertEquals("available".equals(status.getString("status")), status.getBoolean("available"));
    }
}
