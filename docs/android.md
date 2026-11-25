# SuiteMail Android preview

The `codex/android` branch adds an installable Android application using Capacitor 8, the existing React interface, and the existing Rust backend through JNI. Web assets are bundled in the APK; no web development server or desktop computer is required to open the app. SQLite, full-text search, IMAP, SMTP, and private files run on the device.

## Build

### Signed GitHub releases and app updates

The release workflow builds a signed `SuiteMail-X.Y.Z-android.apk` containing ARM64 and x86_64 libraries alongside desktop artifacts. Version names come from `package.json`, and tag builds require a matching `vX.Y.Z` tag. Android version codes use `1 + major * 1000000 + minor * 1000 + patch`; minor and patch must each be at most 999, and major at most 2146. Always increase the version when publishing an update. Manual workflow runs upload artifacts without creating a release; select `android_only` to validate just Android.

The app checks public `MisterTea/SuiteMail` GitHub releases on startup, including after a force-stop. While the app is open, it checks every four hours and on resume when due. Startup and manual checks in Settings skip the four-hour cooldown. All checks respect GitHub's rate-limit backoff. Drafts, prereleases, old versions, and releases without the named APK are ignored. No GitHub credentials are shipped to devices. Checks do not run through a scheduled background worker.

Tap **Update Now** to download into private cache. SuiteMail checks the APK's package ID, newer version code, and certificate against the installed app, then opens Android's installer. Android may first ask you to allow SuiteMail to install from this source. You must confirm installation. Updates preserve existing app data; cancelling leaves the current version installed and allows retry.

**One-time migration:** the old preview APK is debug-signed and cannot be updated with the new release key. Uninstalling it erases local accounts, downloaded mail, settings, and drafts. Save anything needed before uninstalling, install the signed release APK manually, and reconnect accounts. Subsequent signed releases update in place. Gmail in release APKs requires the additional certificate registration described in [Google account setup](android-google.md#direct-release-certificate).

Repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. CI restores the keystore only in runner temporary storage and removes it on exit. Release assembly fails when signing variables are missing. Never regenerate this identity for routine releases. The initial backup is in `C:\Users\JasonGauci\.suitemail-signing`, restricted to that Windows account; keep an additional secure backup because GitHub secrets cannot be downloaded later.

For a local signed build, set those signing variables plus `ANDROID_KEYSTORE_PATH` (the local keystore file), use JDK 21, and run:

```sh
ANDROID_ABIS=arm64-v8a,x86_64 npm run build:android -- --release
```

The default command below remains a debug build for development. The direct APK updater must be removed or disabled before distributing a build through Google Play.

Validation on 2026-11-22: TypeScript checks, the Android web build, 16 targeted UI/service tests, four native release-selection unit tests, and signed release assembly passed. On an isolated API 33 x86_64 emulator, tests verified live public GitHub checks, automatic-check throttling, malformed APK rejection, certificate/version mismatch rejection, installer cancellation, the source-permission flow, and a signed 0.1.0 → 0.1.1 installation retaining a private-data sentinel. The newer APK was supplied as a local fixture to exercise native verification and installer handoff; downloading a published Android release from GitHub remains a first-release smoke check. The Gmail release certificate was registered on 2026-11-22; live release-APK authorization still needs validation after Google propagates the registration.

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

Android and desktop prefill the EWS Application (client) ID with the same bundled public ID. Set `EWS_OAUTH_CLIENT_ID` in `.env` to override the default at build time. Users can also enter a different ID during setup, and their chosen ID is saved with the account. Leave the tenant field blank to sign in through the Microsoft `organizations` endpoint. Restart the development server or rebuild the app after changing the variable.

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

Android messages render without an inset card or extra body padding. HTML content can scroll horizontally inside the message, while long threads retain vertical scrolling. `e2e/androidEmailLayout.spec.ts` checks full-width rendering, responsive content, fixed-width HTML, horizontal touch swipes, and vertical scrolling in the installed app. These scenarios passed on API 36 / WebView 133 on 2026-11-22. Use a current emulator image/WebView for the Playwright runner; older images can lack browser APIs required by the test tools and UI styles.

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

- Google (Gmail) uses native device account authorization and Play services token renewal. The debug and direct-release signing certificates are registered in the `suiteleaf` project. Live Gmail downloads were verified for one emulator account before the project cutover. IMAP app-password setup remains available. [Google account setup and validation](android-google.md)
- Microsoft Graph's current dependency fails to compile on Android, so Graph is excluded from this build and hidden in the account chooser. The desktop integration remains enabled. EWS is compiled but has not been validated against a live Microsoft account on Android.
- Signed Android builds include Proton Mail through the built-in Bridge. See [Proton Mail](#proton-mail).
- On-device AICore inference is not implemented. The Android bridge reports it unavailable and rejects generation; it never returns the previous placeholder response. Configure a cloud provider or reachable remote Pi/Ollama server for AI. The local desktop Llama server is not launched on Android.
- Gmail has native periodic background checks through WorkManager, about every 15 minutes subject to Android scheduling. See [background sync behavior and testing](android-background-sync.md). Historical backfill, IMAP/EWS/calendar sync and scheduled sending remain foreground work; do not rely on scheduled send while the app is closed. Native push/instant notifications remain future work.
- Native document picker/share-sheet integration, Android Keystore wrapping for the encryption key, hardware-device testing, and Play Store distribution remain future work. Direct-download APK signing is configured separately above.

The app's existing encryption key is stored in private app files, and account secrets remain encrypted in SQLite. This is not hardware-backed Keystore storage.

## Proton Mail

The signed Android build runs the bundled Go Bridge inside the app. The device talks directly to Proton. Android Keystore protects the key for Bridge's encrypted vault, and SuperMail's Rust backend talks to Bridge over TLS on loopback using an app-generated trust root. The normal Android account database stores the email address and connection type. Login passwords and Bridge-generated passwords are kept out of that database.

The combined APK with Proton Mail Bridge is distributed under GPLv3. Each release includes an Android source archive with the SuiteMail build scripts and the exact Bridge revision. The APK includes the Bridge license.

In **Add Account → Proton Mail**, enter a paid Proton Mail account's email or username and password. Fill in the authenticator code and separate mailbox password if the account uses them. The Android integration supports foreground sync and authenticator codes. Hardware-key-only sign-in and Proton's interactive human verification require further work.

Local signed builds require Go 1.26.7 on `PATH` and the [pinned Proton Mail Bridge submodule](../submodules/proton-bridge). For an opt-in debug build, run:

```powershell
git submodule update --init submodules/proton-bridge
$env:ANDROID_PROTON_BRIDGE = '1'
$env:ANDROID_ABIS = 'arm64-v8a'
npm run build:android
```

The `dist-android/*-proton-debug.apk` installs as `com.suitemail.app.protondev` alongside the standard app.

For emulator tests, set `ANDROID_ABIS=x86_64` and `ANDROID_PROTON_FIXTURE=1` before building. Install the `*-proton-fixture-debug.apk` on a clean emulator, set `SUITEMAIL_ANDROID_PROTON=1`, and run `npx playwright test --config playwright.android.config.ts androidProton`. The fixture serves synthetic accounts on Android loopback. The x86_64 API 36 test verifies rejected credentials, sign-in, IMAP folder listing and message retrieval, SMTP delivery, and account removal. Signed release builds use the live Proton connection.

## Proton Bridge experiment

The [experimental Android patch](android-proton-bridge-smoke.patch) builds the pinned Bridge revision (`36d7b6a6`) as a headless Android executable. It is a developer experiment and is outside the APK build. It opens only loopback IMAP and SMTP listeners. Use a fresh scratch directory and synthetic data. The patched CLI accepts only `--noninteractive`, and startup can create an unencrypted vault because it has no Android credential store.

From the repository root, use a dedicated PowerShell session with Go 1.26.7, Android NDK 26.1.10909125, and one connected Android emulator.

```powershell
$repo = (Get-Location).Path
$port = Join-Path $env:TEMP 'supermail-proton-android-port'
$sdk = "$env:LOCALAPPDATA/Android/Sdk"
$clang = "$sdk/ndk/26.1.10909125/toolchains/llvm/prebuilt/windows-x86_64/bin/clang.exe"
$adb = "$sdk/platform-tools/adb.exe"
git -C submodules/proton-bridge worktree add --detach $port 36d7b6a6
git -C $port apply "$repo/docs/android-proton-bridge-smoke.patch"
Push-Location $port
$env:GOOS = 'android'
$env:GOARCH = 'amd64'
$env:CGO_ENABLED = '1'
$env:CC = "`"$clang`" --target=x86_64-linux-android26"
go build -mod=readonly -trimpath -ldflags '-s -w -X github.com/ProtonMail/proton-bridge/v3/internal/constants.Version=3.27.2+git' -o bridge-x86_64 ./cmd/Desktop-Bridge
Pop-Location

$remote = '/data/local/tmp/supermail-proton-bridge-smoke'
& $adb shell "mkdir -p $remote"
& $adb push "$port/bridge-x86_64" "$remote/bridge"
& $adb shell 'cd /data/local/tmp/supermail-proton-bridge-smoke && chmod 700 bridge && export HOME=$(mktemp -d "$PWD/home.XXXXXX") && timeout 30 ./bridge --noninteractive'
```

While Bridge is running, use a second terminal to check both greetings. These commands execute inside Android and require neither `adb reverse` nor a mail service on the host.

```powershell
$adb = "$env:LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
& $adb shell 'printf "a001 LOGOUT\r\n" | nc -w 2 127.0.0.1 1143'
& $adb shell 'printf "QUIT\r\n" | nc -w 2 127.0.0.1 1025'
```

After stopping the headless executable, run the upstream integration tests with the same build environment. The test binary hosts its simulated Proton API on Android. On the Android shell, the test harness uses Bridge's authenticated TCP loopback gRPC listener because Android denied its desktop Unix socket bind.

```powershell
Push-Location $port
go test -mod=readonly -c -o bridge-features-x86_64 ./tests
Pop-Location
& $adb push "$port/bridge-features-x86_64" "$remote/features-test"
& $adb push "$port/tests/features" "$remote/"
& $adb shell 'cd /data/local/tmp/supermail-proton-bridge-smoke && chmod 700 features-test && export HOME=$(mktemp -d "$PWD/test-home.XXXXXX") TMPDIR="$PWD" && unset FEATURE_TEST_HOST_URL && FEATURES="features/bridge/default_ports.feature features/imap/auth.feature features/imap/message/fetch.feature features/smtp/auth.feature features/smtp/send/plain.feature" ./features-test -test.run ^TestFeatures$ -test.timeout 100s'
```

All 37 selected scenarios passed on an x86_64 API 36 emulator, covering sign-in, IMAP sync and fetch, and SMTP delivery. For an ARM64 build, set `GOARCH` to `arm64` and use the Clang target `aarch64-linux-android26`. The ARM64 binary compiled, but ARM translation on the x86_64 emulator crashed. This headless test still needs runtime verification on a native ARM64 device.

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
