package com.suitemail.app;

import android.content.Context;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Run explicitly on an isolated emulator; candidate fixtures are supplied via adb. */
@RunWith(AndroidJUnit4.class)
public class AndroidUpdaterTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private AndroidUpdaterPlugin plugin() {
        // Context-only tests do not need the app UI or a JavaScript bridge.
        return new AndroidUpdaterPlugin() { @Override public Context getContext() { return context(); } };
    }
    private File fixture(String name) { return new File(context().getExternalFilesDir("updater-test"), name); }
    private void verify(File file, long code) throws Exception {
        Method method = AndroidUpdaterPlugin.class.getDeclaredMethod("verify", File.class, long.class);
        method.setAccessible(true);
        try { method.invoke(plugin(), file, code); }
        catch (InvocationTargetException e) { throw (Exception) e.getCause(); }
    }
    @Test public void validatesSignedCandidateAndRejectsWrongCertificate() throws Exception {
        assertTrue("Push candidate.apk before running this test", fixture("candidate.apk").isFile());
        verify(fixture("candidate.apk"), 1002);
        try { verify(fixture("wrong-signer.apk"), 1002); fail("Accepted a different signing certificate"); }
        catch (Exception e) { assertTrue(e.getMessage(), e.getMessage().contains("certificate")); }
        try { verify(fixture("candidate.apk"), 1003); fail("Accepted an unexpected version"); }
        catch (Exception e) { assertTrue(e.getMessage(), e.getMessage().contains("version")); }
    }
    @Test public void rejectsMalformedApk() throws Exception {
        File file = new File(context().getCacheDir(), "invalid.apk");
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(new byte[]{1, 2, 3}); }
        try { verify(file, 1002); fail("Accepted a malformed APK"); }
        catch (Exception e) { assertTrue(e.getMessage(), e.getMessage().contains("not a SuiteMail")); }
        finally { file.delete(); }
    }
    @Test public void manualCheckUsesPublicGithubAndAutomaticCheckIsThrottled() throws Exception {
        AndroidUpdaterPlugin updater = plugin();
        class Result extends PluginCall {
            final CountDownLatch done = new CountDownLatch(1);
            String error;
            Result(boolean manual) { super(null, "AndroidUpdater", "test", "check", new JSObject().put("manual", manual)); }
            @Override public void resolve(JSObject result) { done.countDown(); }
            @Override public void reject(String message, Exception exception) { error = message; done.countDown(); }
        }
        context().getSharedPreferences("android-updater", 0).edit().clear().commit();
        Result manual = new Result(true);
        updater.check(manual);
        assertTrue(manual.done.await(60, TimeUnit.SECONDS));
        assertNull(manual.error);
        long next = context().getSharedPreferences("android-updater", 0).getLong("next_check", 0);
        assertTrue(next > System.currentTimeMillis());
        Result automatic = new Result(false);
        updater.check(automatic);
        assertTrue(automatic.done.await(5, TimeUnit.SECONDS));
        assertNull(automatic.error);
        assertEquals(next, context().getSharedPreferences("android-updater", 0).getLong("next_check", 0));
        updater.handleOnDestroy();
    }
    @Test public void retainsDataAcrossInstallation() throws Exception {
        File sentinel = new File(context().getFilesDir(), "updater-retention-test");
        if ("true".equals(InstrumentationRegistry.getArguments().getString("verifyRetention"))) {
            assertEquals("retained", new String(java.nio.file.Files.readAllBytes(sentinel.toPath()), java.nio.charset.StandardCharsets.UTF_8));
        } else {
            try (FileOutputStream output = new FileOutputStream(sentinel)) { output.write("retained".getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        }
    }

    @Test public void opensInstallerForVerifiedCandidate() throws Exception {
        // Run this method separately when testing the permission and confirmation screens.
        org.junit.Assume.assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("openInstaller")));
        verify(fixture("candidate.apk"), 1002);
        android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(new Intent(context(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        AndroidUpdaterPlugin updater = (AndroidUpdaterPlugin) activity.getBridge().getPlugin("AndroidUpdater").getInstance();
        File candidate = new File(context().getCacheDir(), "updates/candidate.apk");
        candidate.getParentFile().mkdirs();
        java.nio.file.Files.copy(fixture("candidate.apk").toPath(), candidate.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        java.lang.reflect.Field ready = AndroidUpdaterPlugin.class.getDeclaredField("ready");
        ready.setAccessible(true); ready.set(updater, candidate);
        Method request = AndroidUpdaterPlugin.class.getDeclaredMethod("requestInstall", PluginCall.class);
        request.setAccessible(true);
        CountDownLatch completed = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> {
            try {
                request.invoke(updater, new PluginCall(null, "AndroidUpdater", "test-installer", "install", new JSObject()) {
                    @Override public void resolve() { completed.countDown(); }
                    @Override public void reject(String message, Exception exception) { completed.countDown(); throw new AssertionError(message, exception); }
                });
            } catch (Exception e) { throw new AssertionError(e); }
        });
        instrumentation.waitForIdleSync();
        assertTrue("Confirm or cancel the installer within 60 seconds", completed.await(60, TimeUnit.SECONDS));
    }
}
