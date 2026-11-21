# SuiteMail Android preview

The `codex/android` branch adds an installable Android application using Capacitor 8, the existing React interface, and the existing Rust backend through JNI. Web assets are bundled in the APK; no web development server or desktop computer is required to open the app. SQLite, full-text search, IMAP, SMTP, and private files run on the device.

## Build

Requirements: Node 24+, npm, a rustup-managed stable Rust toolchain, JDK 21 (Android Studio's bundled JDK works), Android SDK platform 36, and an Android NDK installed under the SDK's `ndk/` directory.

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

## Emulator tests and MP4 recordings

Start an Android emulator in Android Studio, or use an existing configured AVD:

```sh
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.1 -no-snapshot-save
npm run record:android
```

The recording command installs the generated APK, runs all 20 email storyboards, all four AI/manual filter workflows, and a native backend smoke test. Set `ANDROID_SERIAL` if the emulator is not `emulator-5554`. No real email accounts, API keys, outgoing Internet emails, or paid AI requests are needed.

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

- Google sign-in needs an Android-specific OAuth implementation and credential setup. It is disabled in the account chooser; IMAP/SMTP with an app password is the preview path where the provider permits it.
- Microsoft Graph's current dependency fails to compile on Android, so Graph is excluded from this build and hidden in the account chooser. The desktop integration remains enabled. EWS is compiled but has not been validated against a live Microsoft account on Android.
- Proton Mail Bridge requires a desktop OS and is hidden on Android.
- On-device AICore inference is not implemented. The Android bridge reports it unavailable and rejects generation; it never returns the previous placeholder response. Configure a cloud provider or reachable remote Pi/Ollama server for AI. The local desktop Llama server is not launched on Android.
- Sync and send scheduling still use the application's foreground timers. Reliable delivery while Android suspends or kills the app, native push notifications, and WorkManager integration remain future work. Do not rely on scheduled send while the app is closed.
- Native document picker/share-sheet integration, Android Keystore wrapping for the encryption key, hardware-device testing, and Play Store signing/release work remain future work.

The app's existing encryption key is stored in private app files, and account secrets remain encrypted in SQLite. This is not hardware-backed Keystore storage.
