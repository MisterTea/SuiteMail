# SuiteMail Android preview

The `codex/android` branch adds an installable Android application using Capacitor 8, the existing React interface, and the existing Rust backend through JNI. Web assets are bundled in the APK; no web development server or desktop computer is required to open the app. SQLite, full-text search, IMAP, SMTP, and private files run on the device.

## Build

### Signed GitHub releases and app updates

The release workflow builds a signed `SuiteMail-X.Y.Z-android.apk` containing ARM64 and x86_64 libraries alongside desktop artifacts. Version names come from `package.json`, and tag builds require a matching `vX.Y.Z` tag. Android version codes use `1 + major * 1000000 + minor * 1000 + patch`; minor and patch must each be at most 999, and major at most 2146. Always increase the version when publishing an update. Manual workflow runs upload artifacts without creating a release; select `android_only` to validate just Android.

The app checks public `MisterTea/SuiteMail` GitHub releases at startup, every four hours while running, and on resume when due. Automatic check times persist across restarts. Settings offers a manual check. Drafts, prereleases, old versions, and releases without the named APK are ignored. No GitHub credentials are shipped to devices. Checks do not run through a scheduled background worker.

Tap **Update Now** to download into private cache. SuiteMail checks the APK's package ID, newer version code, and certificate against the installed app, then opens Android's installer. Android may first ask you to allow SuiteMail to install from this source. You must confirm installation. Updates preserve existing app data; cancelling leaves the current version installed and allows retry.

**One-time migration:** the old preview APK is debug-signed and cannot be updated with the new release key. Uninstalling it erases local accounts, downloaded mail, settings, and drafts. Save anything needed before uninstalling, install the signed release APK manually, and reconnect accounts. Subsequent signed releases update in place. Gmail in release APKs requires the additional certificate registration described in [Google account setup](android-google.md#direct-release-certificate).

Repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. CI restores the keystore only in runner temporary storage and removes it on exit. Release assembly fails when signing variables are missing. Never regenerate this identity for routine releases. The initial backup is in `C:\Users\JasonGauci\.suitemail-signing`, restricted to that Windows account; keep an additional secure backup because GitHub secrets cannot be downloaded later.

For a local signed build, set those signing variables plus `ANDROID_KEYSTORE_PATH` (the local keystore file), use JDK 21, and run:

```sh
ANDROID_ABIS=arm64-v8a,x86_64 npm run build:android -- --release
```

The default command below remains a debug build for development. The direct APK updater must be removed or disabled before distributing a build through Google Play.

Validation on 2026-11-22: TypeScript checks, the Android web build, 16 targeted UI/service tests, four native release-selection unit tests, and signed release assembly passed. On an isolated API 33 x86_64 emulator, tests verified live public GitHub checks, automatic-check throttling, malformed APK rejection, certificate/version mismatch rejection, installer cancellation, the source-permission flow, and a signed 0.1.0 → 0.1.1 installation retaining a private-data sentinel. The newer APK was supplied as a local fixture to exercise native verification and installer handoff; downloading a published Android release from GitHub remains a first-release smoke check. Gmail release-certificate registration remains pending.

Native unit tests run automatically in release builds. Optional device tests live in `AndroidUpdaterTest`; build with `-PsuiteMailTestRelease assembleReleaseAndroidTest` and the release signing environment. Use only a disposable emulator. Place a same-key APK with the next version code in the target app's external `updater-test/candidate.apk`, plus a copy re-signed with another key as `wrong-signer.apk`. The installer test is opt-in with instrumentation argument `openInstaller=true`, and requires confirming or cancelling within 60 seconds. To check data retention, run `retainsDataAcrossInstallation` before updating and again afterward with `verifyRetention=true`. Successful package replacement kills the old instrumentation process; verify the new version and retained data in a separate run.

### Development build

Requirements: Node 24+, npm, a rustup-managed stable Rust toolchain, JDK 21 (use Android Studio's bundled JDK if it is version 21+), Android SDK platform 36, and an Android NDK installed under the SDK's `ndk/` directory.

On macOS, the script finds the SDK at `~/Library/Android/sdk` and Android Studio's bundled JDK automatically. On other systems set `ANDROID_HOME` and `JAVA_HOME`. Set `ANDROID_NDK_HOME` to choose a specific installed NDK.

```sh
npm ci
npm run build:android
```

Output: `dist-android/SuiteMail-0.1.0-android-debug.apk`. This is a debug-signed ARM64 APK for Android 8.0/API 26 and later. It can be installed on an ARM64 phone or ARM64 emulator. To include an Intel emulator build:

```sh
ANDROID_ABIS=arm64-v8a,x86_64 npm run build:android
```

`android/gradlew` packages the application; the script first builds `supermail_android` with the NDK compiler and copies the shared library into the APK. Generated native libraries, copied web assets, local SDK paths, APKs, and recordings are ignored by Git. Desktop Node bindings remain the default core feature; the Android crate disables Node bindings and the desktop Graph dependency. EWS data types are shared separately.

The Android build excludes both desktop Gmail environment credentials. Backups of app data are disabled. Production Capacitor configuration disallows mixed HTTP content; the debug build explicitly enables it for local fixtures and remote development AI servers. This APK is a development preview, not a Play Store release.

## EWS application ID default

Set `EWS_OAUTH_CLIENT_ID` in `.env` to prefill the EWS Application (client) ID field:

```dotenv
EWS_OAUTH_CLIENT_ID=bd4d4c73-8649-4fd0-9c9d-3a88e73432f5
```

This public ID is bundled at build time for both Android and desktop. Users can edit or clear it before signing in; their chosen ID is saved with the account. The tenant field stays blank. If the variable is unset, the application ID field also starts blank. Restart the development server or rebuild the app after changing the variable.

## Live reload for day-to-day development

Start an emulator (or connect an authorized USB Android device), then run:

```sh
npm run dev:android
```

The command starts Vite in Android mode, forwards port 1420 over adb, builds and installs a debug shell, and launches SuiteMail against the local development server. React and CSS edits update inside the actual Android app through Vite HMR. Native plugins and the Rust backend still run on the device. Some module changes require a full page reload; React Fast Refresh preserves component state when possible. The first run prepares missing native libraries and bundled assets automatically.

No LAN IP or Wi-Fi setup is needed. Vite listens only on the computer's loopback interface. Port 1420 must be free. If multiple devices are connected, set `ANDROID_SERIAL`; set `ANDROID_ABIS=x86_64` for an Intel emulator. Desktop Gmail credentials remain excluded because Vite runs in Android mode.

Kotlin/Java and Android resource changes take effect when restarting the command. For Rust changes, rebuild explicitly:

```sh
npm run dev:android -- --native
```

Ctrl+C stops the server, restores and reinstalls the bundled app, and launches it without the development server. Keep the device connected during shutdown. Bundled fallback assets are from the most recent normal build; use `npm run build:android` for a fresh packaged UI. Stopping forcibly (for example, killing the process without a signal) can leave the installed debug app expecting Vite; starting this command and stopping it normally restores it. The live URL is written only to ignored generated assets during debug assembly and restored immediately afterward. The source Capacitor configuration and distribution APK are not modified. Use `npm run record:android` for packaged-app verification, after stopping live reload.

## Emulator tests and MP4 recordings

Start an Android emulator in Android Studio, or use an existing configured AVD:

```sh
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.1 -no-snapshot-save
npm run record:android
```

The recording command installs the generated APK, runs all 20 email storyboards, all four AI/manual filter workflows, a native backend smoke test, and Android account setup checks. Set `ANDROID_SERIAL` if the emulator is not `emulator-5554`. No real email accounts, API keys, outgoing Internet emails, or paid AI requests are needed.

Each scenario runs against the installed application's WebView at `https://localhost`, using its packaged production interface. Playwright connects directly to that app's debugging socket. Touch actions are dispatched as touch events to the real Android WebView. Android `screenrecord` records the emulator display as H.264 MP4, rather than recording a desktop browser resized to phone dimensions. The recorder signals only the screenrecord process it started.

Outputs:

- `recordings/android/*.mp4`: one screen recording per scenario.
- `recordings/android/*.png`: final emulator screenshots.
- `recordings/android/manifest.json`: titles, actual test status, filenames, duration, dimensions, codec, and emulator serial.
- `test-results/android-results.json`: detailed Playwright results.

To rerun a subset:

```sh
npm run record:android -- --grep 'Compose and Send'
npm run record:android -- --grep 'Native Android'
```

A full run resets the recording manifest. Subset runs append results, so use the latest entry for a repeated scenario. Tests fail on assertion failures or invalid/empty MP4s; the recorder does not report a failed scenario as a success.

### What the tests prove

The 24 existing workflow scenarios use the established `FakeServer` fixtures for email, SQL, and AI boundaries. Those fixtures are injected only by the test runner and are not shipped in the APK. They exercise the real bundled interface, navigation, composer, filtering, and user actions on Android. AI recordings use deterministic model replies, not on-device inference.

The additional native scenario does not inject the fake bridge. It verifies actual Rust SQLite migrations and full-text tables, parameterized writes that survive a reload, private file reads/writes, a real IMAP protocol exchange with a local fixture server, and SMTP delivery through Rust to a local fixture server. Both servers are reached through `adb reverse`.

## Preview limitations

- Google (Gmail) now uses native device account authorization and Play services token renewal. The current debug package/signing certificate is registered in `bits-and-bytes`; a production certificate needs its own registration. See [Google account setup and validation](android-google.md). Live Gmail downloads are verified for one emulator account; live sending, multiple real accounts and revocation still need separate checks. IMAP app-password setup remains available.
- Microsoft Graph's current dependency fails to compile on Android, so Graph is excluded from this build and hidden in the account chooser. The desktop integration remains enabled. EWS is compiled but has not been validated against a live Microsoft account on Android.
- Proton Mail Bridge requires a desktop OS and is hidden on Android.
- On-device AICore inference is not implemented. The Android bridge reports it unavailable and rejects generation; it never returns the previous placeholder response. Configure a cloud provider or reachable remote Pi/Ollama server for AI. The local desktop Llama server is not launched on Android.
- Gmail has native periodic background checks through WorkManager, about every 15 minutes subject to Android scheduling. See [background sync behavior and testing](android-background-sync.md). Historical backfill, IMAP/EWS/calendar sync and scheduled sending remain foreground work; do not rely on scheduled send while the app is closed. Native push/instant notifications remain future work.
- Native document picker/share-sheet integration, Android Keystore wrapping for the encryption key, hardware-device testing, and Play Store distribution remain future work. Direct-download APK signing is configured separately above.

The app's existing encryption key is stored in private app files, and account secrets remain encrypted in SQLite. This is not hardware-backed Keystore storage.

## Gmail initial-download behavior

Gmail requests are paced by their current quota costs, with headroom under the per-user limit. Quota-related 403 responses and HTTP 429 responses honor Retry-After/cooldowns; genuine permission failures are not retried as quota errors. Initial sync streams small pages, publishes inbox/count updates while downloading, and persists a page checkpoint after each stored thread. Interrupted sync resumes completed work; a failure never advances the history cursor past missed mail. Delta sync likewise retains its history cursor if a required thread fails. The initial history cursor is captured before downloading so later delta sync can replay changes made during the download.

Validation on 2026-11-21: 2,092 non-live-model unit tests passed; the updated installed APK showed 50 rendered mail rows and five successful live Gmail thread responses over 15 seconds, without quota errors. Existing account and 419 stored messages were retained. Historical backfill requires the app to remain open; new Gmail downloads also have native periodic background checks.

During initial Gmail backfill, each foreground sync cycle now polls history changes first, then downloads at most 10 older threads. The 60-second timer can therefore check new mail between bounded chunks. Its live cursor is stored in the initial-download checkpoint without marking the historical download complete; the normal account history cursor is installed when backfill finishes. New messages publish UI refreshes as soon as they are stored. If the checkpoint history expires, a fresh listing restarts from recent mail without deleting downloaded messages.

Native periodic Gmail checks are now available while the app is closed. See [background sync](android-background-sync.md) for behavior, settings, and validation.

## On-device AiCore

Android offers **AiCore** instead of the remote Ollama and Pi providers. It uses ML Kit `genai-prompt` with `ModelPreference.FULL` and `ModelReleaseStage.STABLE`. Android chooses the actual model; legacy model names in settings do not select arbitrary Gemma models.

Settings → AI checks device support. If a model download is needed, choose **Set up AiCore**. Downloads can take several minutes. Unsupported devices show an unavailable message; inference never silently switches to a cloud provider or FAST model. Most emulators cannot run AiCore inference, so validate generation on a supported physical device.

### Host AI in the emulator

Android emulators also offer **Host AI (Ollama / LMStudio)**. Start the AI server on your computer, select this provider, and enter an installed model name. Ollama defaults to `http://10.0.2.2:11434`; for LM Studio use `http://10.0.2.2:1234`. Saved localhost URLs are mapped to the emulator host while retaining their port. Requests use Android native HTTP, so the host server does not need WebView CORS configuration. This option is not shown on physical Android devices.

## Sandbox account

Enable **Settings → Accounts → Sandbox account** to create and switch to a local demo mailbox with 75 procedurally generated emails. Sandbox sends never use SMTP or an external mail API. The first send in a conversation receives an immediate generated reply; later sends in that conversation do not receive another automatic reply. This is persisted across restarts, and retrying the same send does not duplicate it.

Disabling the account hides it and preserves its mail; enabling it again restores it. Use the normal AI provider settings to try drafting, rewriting, and summarization with the generated mail, including Host AI on an Android emulator.
