package com.suitemail.app;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.view.WindowManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

/** Captures the public-client HTTPS reply inside a native window, outside the app WebView. */
final class OAuthLoginDialog {
    private final Dialog dialog;
    private final WebView webView;
    private final PluginCall call;
    private final String redirectUri;
    private final String expectedState;
    private boolean finished;
    private final Runnable onFinished;

    OAuthLoginDialog(Activity activity, PluginCall call, String authUrl, String redirectUri,
                     String expectedState, Runnable onFinished) {
        this.call = call;
        this.redirectUri = redirectUri;
        this.expectedState = expectedState;
        this.onFinished = onFinished;
        dialog = new Dialog(activity, android.R.style.Theme_Material_Light_NoActionBar);
        webView = new WebView(activity);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // No JavaScript bridge is exposed to sign-in or federated identity-provider pages.
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame() && navigate(request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return navigate(url);
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                navigate(url);
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                fail("Cannot securely connect to the sign-in page.");
            }
            @Override public void onReceivedError(WebView view, android.webkit.WebResourceRequest request,
                                                   android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) fail("Cannot load the sign-in page. Check your connection and try again.");
            }
        });
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        Button cancel = new Button(activity);
        cancel.setText("Cancel sign-in");
        cancel.setOnClickListener(view -> cancel());
        layout.addView(cancel);
        layout.addView(webView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        // Keep controls clear of camera cutouts, status bars, and the navigation area.
        WindowCompat.setDecorFitsSystemWindows(dialog.getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(layout, (view, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        dialog.setContentView(layout);
        dialog.setOnCancelListener(ignored -> cancel());
        dialog.show();
        dialog.getWindow().setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
        ViewCompat.requestApplyInsets(layout);
        webView.loadUrl(authUrl);
    }

    static boolean matchesRedirect(String url, String redirect) {
        Uri actual = Uri.parse(url);
        Uri expected = Uri.parse(redirect);
        return expected.getScheme() != null && expected.getScheme().equals(actual.getScheme())
            && expected.getEncodedAuthority() != null
            && expected.getEncodedAuthority().equals(actual.getEncodedAuthority())
            && expected.getEncodedPath() != null
            && expected.getEncodedPath().equals(actual.getEncodedPath());
    }

    private boolean navigate(String url) {
        if (finished) return true;
        if (matchesRedirect(url, redirectUri)) {
            try {
                JSObject result = parseReply(url, expectedState);
                finished = true;
                JSObject envelope = new JSObject();
                envelope.put("value", result);
                call.resolve(envelope);
                dispose();
            } catch (IllegalArgumentException e) {
                fail(e.getMessage());
            }
            return true;
        }
        if (!"https".equals(Uri.parse(url).getScheme())) {
            fail("This sign-in requires an unsupported redirect. Contact your organization's administrator.");
            return true;
        }
        return false;
    }

    static JSObject parseReply(String url, String expectedState) {
        Uri reply = Uri.parse(url);
        if (!expectedState.equals(reply.getQueryParameter("state"))) {
            throw new IllegalArgumentException("Sign-in state did not match. Please try again.");
        }
        String error = reply.getQueryParameter("error");
        if (error != null) {
            String description = reply.getQueryParameter("error_description");
            throw new IllegalArgumentException(description != null ? description : error);
        }
        String code = reply.getQueryParameter("code");
        if (code == null || code.isEmpty()) {
            throw new IllegalArgumentException("Microsoft did not return a sign-in code.");
        }
        JSObject result = new JSObject();
        result.put("code", code);
        result.put("state", expectedState);
        return result;
    }

    void cancel() { fail("Sign-in was cancelled."); }

    private void fail(String message) {
        if (finished) return;
        finished = true;
        call.reject(message);
        dispose();
    }

    private void dispose() {
        webView.stopLoading();
        dialog.dismiss();
        webView.destroy();
        onFinished.run();
    }
}
