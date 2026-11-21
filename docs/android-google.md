# Google accounts on Android

Google (Gmail) in Add Account now opens Google Play services' native account/consent flow. Each added account gets its own local mailbox and native token provider. Adding another account always requests account selection, even if an account previously granted access. Re-authorize in Settings is pinned to the existing mailbox email and rejects any different identity.

No Google password, desktop client secret, or Google refresh token is required or stored for this Android path. Access tokens are encrypted through the existing SQLite account layer. Play services owns token caching and renewal. SuiteMail silently checks authorization for the particular email after startup and periodically during use; a Gmail 401 clears the rejected native token before a single retry. Missing/revoked access surfaces a reconnect error, never a background consent window. Cancelled or incomplete authorization does not create an account. IMAP / SMTP remains a separate app-password alternative.

The requested permissions match SuiteMail's mail and calendar integration: Gmail modify (including read, send and label operations), Google profile/email, calendar read, and calendar events. Mail and calendar grants are checked before accepting an account, so declining them cannot create an account that immediately fails silent renewal. The selected identity is fetched from Google's userinfo endpoint; identity is not inferred from an arbitrary account name supplied by the frontend.

## Register the Android application with Google

In the Google Cloud project used for SuiteMail:

1. Enable the Gmail API and Google Calendar API.
2. Configure Google Auth Platform branding, audience and data access for the scopes below. While the project is in Testing, add the accounts that will test SuiteMail as test users. A public distribution may require Google's scope verification.
3. Create an OAuth client of type **Android**, with package **com.suitemail.app** and the SHA-1 certificate fingerprint of the installed build. Debug and production signing certificates need separate Android client registrations. A Google Play distribution uses its app-signing certificate.
4. Run the installed app on a Google Play services device, choose Google (Gmail), select an account and grant the requested access. Add Account can be repeated for another account.

This machine's current debug signing fingerprint (public, not a credential):

```text
8B:DD:E5:67:51:CA:3E:18:FD:AF:69:CB:04:56:6C:97:F2:3E:37:18
```

To inspect fingerprints for your local build, use Android Studio's signing report or:

```sh
cd android
./gradlew signingReport
```

No client ID or client secret is entered in SuiteMail for this device-only authorization flow. Google identifies the Android OAuth registration from the package and signing certificate. Server auth-code exchange and server-side refresh tokens are not used. A desktop OAuth client does not register an Android signing certificate.

Scopes:

```text
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
```

Google configuration errors show the package/certificate registration requirement in the app. Without Play services, use IMAP / SMTP. Remove an account in SuiteMail to remove its local mailbox; to revoke Google's grants too, remove SuiteMail under your Google Account's third-party connections. Removal in SuiteMail does not sign the Google account out of Android.

## Validation and current limits

The installed-APK emulator check opens the real Google authorization surface and cancels it, verifies no account was created, and verifies retry remains available. This emulator has no Google accounts. Unit tests cover selecting an account, verified profile lookup, cancellation, account mismatch, independent per-account renewal without refresh tokens, concurrent refresh, 401 invalidation/retry, and reconnection.

A successful live consent, real Gmail sync/send, multiple actual device accounts, and consent revocation still require the project registration and test accounts. They are not claimed as validated by the cancellation smoke test. The API dependency is `com.google.android.gms:play-services-auth:22.0.0`; the implementation uses the current AuthorizationClient API, not the deprecated GoogleSignIn API. A separate Credential Manager app-login flow is unnecessary because SuiteMail is authorizing mailbox data access and reads the selected profile after authorization.

References: [Google Android authorization guide](https://developer.android.com/identity/authorization), [AuthorizationRequest account selection](https://developers.google.com/android/reference/com/google/android/gms/auth/api/identity/AuthorizationRequest.Builder).
