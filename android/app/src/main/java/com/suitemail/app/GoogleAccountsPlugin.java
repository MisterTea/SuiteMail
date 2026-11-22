package com.suitemail.app;

import android.accounts.Account;
import android.app.Activity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.json.JSONArray;

/** Google Play services owns account credentials and token renewal. No account enumeration permission. */
@CapacitorPlugin(name = "GoogleAccounts")
public class GoogleAccountsPlugin extends Plugin {
    static final List<String> SCOPES = Arrays.asList(
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events"
    );
    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall interactiveCall;

    @Override public void load() {
        consent = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(), result -> {
                PluginCall call = interactiveCall;
                if (call == null) return; // Activity was recreated; JS must retry, never guess an account.
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    reject(call, "Google account selection was cancelled.", "GOOGLE_CANCELLED");
                    return;
                }
                try {
                    complete(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData()));
                } catch (Exception e) { failure(call, e); }
            }
        );
    }

    @PluginMethod public void authorize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) != ConnectionResult.SUCCESS) {
                call.reject("Google Play services is unavailable. Update it or connect using IMAP / SMTP.", "GOOGLE_PLAY_SERVICES_UNAVAILABLE");
                return;
            }
            boolean interactive = call.getBoolean("interactive", false);
            String email = call.getString("email", "").trim();
            if (!interactive && email.isEmpty()) {
                call.reject("A Google account is required for token renewal.", "GOOGLE_ACCOUNT_REQUIRED"); return;
            }
            if (interactive) {
                if (interactiveCall != null) { call.reject("Finish the current Google account selection first.", "GOOGLE_BUSY"); return; }
                interactiveCall = call;
            }
            String invalidToken = call.getString("invalidToken", "");
            if (!invalidToken.isEmpty()) {
                Identity.getAuthorizationClient(getActivity())
                    .clearToken(ClearTokenRequest.builder().setToken(invalidToken).build())
                    .addOnSuccessListener(unused -> request(call, email, interactive))
                    .addOnFailureListener(e -> failure(call, e));
            } else request(call, email, interactive);
        });
    }

    private void request(PluginCall call, String email, boolean interactive) {
        AuthorizationRequest.Builder builder = AuthorizationRequest.builder()
            .setRequestedScopes(SCOPES.stream().map(Scope::new).collect(Collectors.toList()));
        // Always offer an account choice when adding: previously granted accounts must not hide other accounts.
        if (email.isEmpty()) builder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT);
        else builder.setAccount(new Account(email, "com.google"));
        Identity.getAuthorizationClient(getActivity()).authorize(builder.build())
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    if (!interactive) {
                        reject(call, "Reconnect this Google account in Settings to grant access again.", "GOOGLE_REAUTH_REQUIRED");
                    } else {
                        try { consent.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build()); }
                        catch (Exception e) { failure(call, e); }
                    }
                } else complete(call, result);
            })
            .addOnFailureListener(e -> failure(call, e));
    }

    private void complete(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty() || !result.getGrantedScopes().containsAll(Arrays.asList(SCOPES.get(0), SCOPES.get(3), SCOPES.get(4)))) {
            reject(call, "Mail and calendar access was not fully granted. Allow the requested access when reconnecting.", "GOOGLE_PERMISSION_REQUIRED"); return;
        }
        JSObject data = new JSObject();
        data.put("accessToken", token);
        data.put("scopes", new JSONArray(result.getGrantedScopes()));
        // Play services caches/renews real token expiry. Recheck conservatively every few minutes;
        // Gmail 401 responses additionally clear the invalid token before requesting another.
        data.put("expiresIn", 600);
        if (interactiveCall == call) interactiveCall = null;
        call.resolve(data);
    }

    private void reject(PluginCall call, String message, String code) {
        if (interactiveCall == call) interactiveCall = null;
        call.reject(message, code);
    }

    private void failure(PluginCall call, Exception error) {
        int status = error instanceof ApiException ? ((ApiException) error).getStatusCode() : -1;
        if (!call.getBoolean("interactive", false) && (status == 4 || status == 6 || status == 16 || status == 12501))
            reject(call, "Reconnect this Google account in Settings to grant access again.", "GOOGLE_REAUTH_REQUIRED");
        else if (status == 12501 || status == 16) reject(call, "Google account selection was cancelled.", "GOOGLE_CANCELLED");
        else if (status == 10 || status == 12500) reject(call,
            "Google sign-in is not configured for this SuiteMail build. Register com.suitemail.app and its signing certificate in the Google Cloud project.", "GOOGLE_CONFIGURATION_REQUIRED");
        else reject(call, "Google authorization failed (" + status + "). Check your connection and try again.", "GOOGLE_AUTH_FAILED");
    }

    @Override protected void handleOnDestroy() {
        if (interactiveCall != null) reject(interactiveCall, "Google account selection was interrupted. Please try again.", "GOOGLE_CANCELLED");
        if (consent != null) consent.unregister();
    }
}
