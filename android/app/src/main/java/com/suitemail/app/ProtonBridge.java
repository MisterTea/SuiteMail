package com.suitemail.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class ProtonBridge {
    static final String ACCOUNT_HOST = "supermail-proton-android";
    private static final String KEY_ALIAS = "suitemail.proton.vault";
    private static final boolean AVAILABLE = loadLibrary();
    private static boolean started;

    private static boolean loadLibrary() {
        try {
            System.loadLibrary("proton_android");
            return true;
        } catch (UnsatisfiedLinkError e) {
            return false;
        }
    }

    static boolean isAvailable() {
        return AVAILABLE;
    }

    static synchronized Object invoke(Context context, String command, JSObject args) throws Exception {
        ensureStarted(context);
        JSObject request = new JSObject(args.toString());
        request.put("command", command);
        return run(request);
    }

    static synchronized void configure(Context context, JSONObject config, boolean smtp) throws Exception {
        ensureStarted(context);
        JSObject request = new JSObject();
        request.put("command", "connection");
        request.put("email", config.getString("username"));
        JSONObject connection = (JSONObject) run(request);
        config.put("host", "127.0.0.1");
        config.put("port", connection.getInt(smtp ? "smtpPort" : "imapPort"));
        config.put("security", "tls");
        config.put("auth_method", "password");
        config.put("password", connection.getString("password"));
        config.put("accept_invalid_certs", false);
        config.put("trusted_certificate_der", connection.getString("certificate"));
    }

    private static void ensureStarted(Context context) throws Exception {
        if (!AVAILABLE) throw new IllegalStateException("This Android build does not include Proton Bridge.");
        if (started) return;
        File directory = new File(context.getNoBackupFilesDir(), "proton-bridge");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot create the Proton data directory.");
        byte[] key = loadVaultKey(directory);
        try {
            JSObject request = new JSObject();
            request.put("command", "start");
            request.put("directory", directory.getAbsolutePath());
            request.put("key", Base64.encodeToString(key, Base64.NO_WRAP));
            run(request);
            started = true;
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    private static byte[] loadVaultKey(File directory) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        AtomicFile file = new AtomicFile(new File(directory, "vault-key"));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        if (file.getBaseFile().exists() || new File(directory, "vault-key.bak").exists()) {
            if (!keyStore.containsAlias(KEY_ALIAS)) throw new IllegalStateException("The Android Proton vault key is missing.");
            byte[] wrapped = file.readFully();
            if (wrapped.length != 60) throw new IllegalStateException("The Android Proton vault key is invalid.");
            cipher.init(Cipher.DECRYPT_MODE, (SecretKey) keyStore.getKey(KEY_ALIAS, null),
                new GCMParameterSpec(128, wrapped, 0, 12));
            return cipher.doFinal(wrapped, 12, wrapped.length - 12);
        }

        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        try {
            if (!keyStore.containsAlias(KEY_ALIAS)) {
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
                generator.generateKey();
            }
            cipher.init(Cipher.ENCRYPT_MODE, (SecretKey) keyStore.getKey(KEY_ALIAS, null));
            byte[] wrapped = ByteBuffer.allocate(60).put(cipher.getIV()).put(cipher.doFinal(key)).array();
            FileOutputStream output = file.startWrite();
            try {
                output.write(wrapped);
                file.finishWrite(output);
            } catch (Exception e) {
                file.failWrite(output);
                throw e;
            }
            return key;
        } catch (Exception e) {
            Arrays.fill(key, (byte) 0);
            throw e;
        }
    }

    private static Object run(JSObject request) throws Exception {
        byte[] input = request.toString().getBytes(StandardCharsets.UTF_8);
        byte[] output = null;
        try {
            output = nativeCall(input);
            if (output == null) throw new IllegalStateException("Proton Bridge did not return a response.");
            JSONObject result = new JSONObject(new String(output, StandardCharsets.UTF_8));
            if (result.has("error")) throw new IllegalStateException(result.getString("error"));
            return result.get("value");
        } finally {
            Arrays.fill(input, (byte) 0);
            if (output != null) Arrays.fill(output, (byte) 0);
        }
    }

    private static native byte[] nativeCall(byte[] request);
}
