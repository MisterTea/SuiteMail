package com.suitemail.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.*;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** On-device inference only. Never substitutes a cloud provider or a smaller model. */
final class AiCoreBridge {
    private GenerativeModelFutures model;
    private final Object modelOperations = new Object();
    private volatile ModelDownload activeDownload;

    static GenerationConfig fullConfiguration() {
        ModelConfig.Builder config = new ModelConfig.Builder();
        config.setPreference(ModelPreference.FULL);
        config.setReleaseStage(ModelReleaseStage.STABLE);
        GenerationConfig.Builder generation = new GenerationConfig.Builder();
        generation.setModelConfig(config.build());
        return generation.build();
    }

    private synchronized GenerativeModelFutures client() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient(fullConfiguration()));
        return model;
    }

    Object invoke(String command, JSObject args, Context context) throws Exception {
        if (command.equals("aicore_is_available")) {
            ModelDownload download = activeDownload;
            if (download != null) return download.status;
            try { return describe(client().checkStatus().get(30, TimeUnit.SECONDS)); }
            catch (Exception e) {
                if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                JSObject result = describe(FeatureStatus.UNAVAILABLE);
                result.put("message", "AiCore FULL is unavailable on this device. Update Android AiCore and try again.");
                return result;
            }
        }
        synchronized (modelOperations) {
            return invokeModel(command, args, context);
        }
    }

    private Object invokeModel(String command, JSObject args, Context context) throws Exception {
        int status = client().checkStatus().get(30, TimeUnit.SECONDS);
        if (command.equals("aicore_prepare")) {
            if (status == FeatureStatus.DOWNLOADABLE) {
                JSObject blocked = checkDownloadConnection(context, Boolean.TRUE.equals(args.getBool("allowMeteredDownload")));
                if (blocked != null) return blocked;
                ModelDownload download = new ModelDownload();
                activeDownload = download;
                try {
                    var future = client().download(download);
                    try {
                        future.get(20, TimeUnit.MINUTES);
                    } catch (TimeoutException e) {
                        future.cancel(true);
                        throw new IllegalStateException("AiCore setup timed out. Check availability and try again.");
                    } catch (InterruptedException e) {
                        future.cancel(true);
                        Thread.currentThread().interrupt();
                        throw e;
                    }
                    if (download.failure != null) throw download.failure;
                    status = client().checkStatus().get(30, TimeUnit.SECONDS);
                } finally {
                    activeDownload = null;
                }
            }
            return describe(status);
        }
        if (status != FeatureStatus.AVAILABLE) throw new IllegalStateException(message(status));
        String system = args.getString("systemPrompt", "");
        String prompt = args.getString("prompt", "");
        GenerateContentRequest.Builder request;
        if (!system.isEmpty() && client().isSystemPromptAvailable().get(30, TimeUnit.SECONDS)) {
            request = new GenerateContentRequest.Builder(new SystemInstruction(system), new TextPart(prompt));
        } else {
            request = new GenerateContentRequest.Builder(new TextPart(
                system.isEmpty() ? prompt : system + "\n\n" + prompt));
        }
        Integer maxTokens = args.getInteger("maxTokens");
        if (maxTokens != null && maxTokens > 0) request.setMaxOutputTokens(Math.min(maxTokens, 4096));
        GenerateContentResponse response = client().generateContent(request.build()).get(180, TimeUnit.SECONDS);
        if (response.getCandidates().isEmpty() || response.getCandidates().get(0).getText().trim().isEmpty()) {
            throw new IllegalStateException("AiCore returned no text. Try a shorter request.");
        }
        return response.getCandidates().get(0).getText();
    }

    private static JSObject checkDownloadConnection(Context context, boolean allowMeteredDownload) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        NetworkCapabilities network = manager == null ? null : manager.getNetworkCapabilities(manager.getActiveNetwork());
        if (network == null || !network.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
            JSObject offline = describe(FeatureStatus.DOWNLOADABLE);
            offline.put("message", "Connect to the internet to download the AiCore model.");
            return offline;
        }
        if (!allowMeteredDownload && !(network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                && network.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))) {
            JSObject consent = describe(FeatureStatus.DOWNLOADABLE);
            consent.put("downloadRequiresConsent", true);
            return consent;
        }
        return null;
    }

    private static final class ModelDownload implements DownloadCallback {
        private volatile JSObject status = describe(FeatureStatus.DOWNLOADING);
        private volatile GenAiException failure;
        private long totalBytes;
        private long downloadedBytes;
        private boolean completed;

        @Override public synchronized void onDownloadStarted(long bytesToDownload) {
            totalBytes = bytesToDownload;
            updateProgress(downloadedBytes);
        }

        @Override public synchronized void onDownloadProgress(long totalBytesDownloaded) {
            updateProgress(totalBytesDownloaded);
        }

        @Override public synchronized void onDownloadCompleted() {
            completed = true;
            JSObject finishing = describe(FeatureStatus.DOWNLOADING);
            finishing.put("downloadPercentage", 100);
            finishing.put("message", "Finishing AiCore setup…");
            status = finishing;
        }

        @Override public void onDownloadFailed(GenAiException error) {
            failure = error;
        }

        private void updateProgress(long bytes) {
            if (completed) return;
            downloadedBytes = Math.max(downloadedBytes, bytes);
            JSObject progress = describe(FeatureStatus.DOWNLOADING);
            progress.put("downloadedBytes", downloadedBytes);
            if (totalBytes > 0) {
                progress.put("downloadPercentage", (int) Math.min(100, downloadedBytes * 100.0 / totalBytes));
            }
            status = progress;
        }
    }

    static JSObject describe(int status) {
        JSObject result = new JSObject();
        result.put("available", status == FeatureStatus.AVAILABLE);
        JSArray supported = new JSArray();
        if (status != FeatureStatus.UNAVAILABLE) supported.put("full");
        result.put("supported_models", supported);
        result.put("status", status == FeatureStatus.AVAILABLE ? "available" : status == FeatureStatus.DOWNLOADABLE
            ? "downloadable" : status == FeatureStatus.DOWNLOADING ? "downloading" : "unavailable");
        result.put("message", message(status));
        return result;
    }

    private static String message(int status) {
        if (status == FeatureStatus.AVAILABLE) return "AiCore FULL is ready.";
        if (status == FeatureStatus.DOWNLOADABLE) return "Download the on-device model using Set up AiCore.";
        if (status == FeatureStatus.DOWNLOADING) return "Downloading the on-device model…";
        return "AiCore FULL is not supported or is not ready on this device.";
    }
}
