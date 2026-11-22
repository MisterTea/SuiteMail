package com.suitemail.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.prompt.*;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;
import java.util.concurrent.TimeUnit;

/** On-device inference only. Never substitutes a cloud provider or a smaller model. */
final class AiCoreBridge {
    private GenerativeModelFutures model;

    static GenerationConfig fullConfiguration() {
        ModelConfig.Builder config = new ModelConfig.Builder();
        config.setPreference(ModelPreference.FULL);
        config.setReleaseStage(ModelReleaseStage.STABLE);
        GenerationConfig.Builder generation = new GenerationConfig.Builder();
        generation.setModelConfig(config.build());
        return generation.build();
    }

    private GenerativeModelFutures client() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient(fullConfiguration()));
        return model;
    }

    synchronized Object invoke(String command, JSObject args) throws Exception {
        if (command.equals("aicore_is_available")) {
            try { return describe(client().checkStatus().get(30, TimeUnit.SECONDS)); }
            catch (Exception e) {
                if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                JSObject result = describe(FeatureStatus.UNAVAILABLE);
                result.put("message", "AiCore FULL is unavailable on this device. Update Android AiCore and try again.");
                return result;
            }
        }
        int status = client().checkStatus().get(30, TimeUnit.SECONDS);
        if (command.equals("aicore_prepare")) {
            if (status == FeatureStatus.DOWNLOADABLE) {
                client().download(new DownloadCallback() {}).get(20, TimeUnit.MINUTES);
                status = client().checkStatus().get(30, TimeUnit.SECONDS);
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
        if (status == FeatureStatus.DOWNLOADING) return "The on-device model is downloading. Check again when it finishes.";
        return "AiCore FULL is not supported or is not ready on this device.";
    }
}
