# Periodic Android Gmail checks

Background Gmail sync is enabled by default and can be changed in **Settings → Accounts → Background Gmail sync**. Android WorkManager schedules one unique recurring job with a 15-minute interval, connected-network and battery-not-low constraints. Android can defer work for battery/Doze policies; this is not an exact 15-minute alarm. Ordinary task dismissal/process death does not require the app's interface to stay open. Explicit Android **Force stop** prevents scheduled work until the app is opened again.

The existing one-minute foreground checks still run while SuiteMail is active. They pause when the app becomes inactive and restart on resume. Historical initial backfill, mailbox rules, calendar sync and scheduled sending still run in the foreground. This implementation adds closed-app Gmail downloads, not background IMAP/EWS, instant push or background send scheduling.

## Implementation

- `BackgroundMailScheduler` registers unique WorkManager work. It survives normal process death/reboot through WorkManager persistence. Disabling the setting cancels work carrying the background-mail tag.
- `BackgroundMailWorker` uses an application Context, Google Play services AuthorizationClient, native HTTPS, and a read-only view of the account database. It never creates an Activity/WebView or launches consent. Google owns token renewal; no Google password/refresh token is stored by this worker. Missing authorization is reported in Accounts so the user can reconnect.
- Each account has an independent native history checkpoint and pending-thread list. The initial run also prefetches the latest five inbox threads. Requests use the same conservative quota budget as foreground sync, stop for foreground activity, honor quota cooldowns, and retry temporary failures through WorkManager. Downloads are bounded to 15 threads per account per run, with incremental durable checkpoints.
- Full Gmail JSON is saved atomically to app-private files. Deleted threads are represented as tombstones. An exact version receipt ensures importing an older snapshot cannot acknowledge/delete a newer download of the same thread.
- On startup/resume and foreground sync cycles, cached downloads are imported using SuiteMail's existing message parser, SQLite storage, authentication-header parsing, categorization and rules. Imports work offline. Pending local edits defer an import, and failed imports remain queued. Native worker cursors never falsely mark the foreground historical backfill complete.
- Cached mail has the same app-private protection as existing mail-body storage; this change does not add hardware-backed body encryption. Access tokens are held in worker memory and are not written to the background cache/preferences or diagnostic output.

## Validation

On the API 36 ARM64 emulator:

- Full non-live-model unit suite: **2,105 tests / 222 files passed**.
- Native instrumentation: **4 tests passed**, covering durable files, deletion markers, traversal rejection and stale receipts across separate store instances.
- Verified recurring WorkManager registration with an interval of **900,000 ms** and an enqueued state.
- Terminated the SuiteMail process, then dispatched the real worker using a debug-only one-time WorkManager trigger. A fresh process successfully checked Google while the launcher remained visible; no SuiteMail activity was opened.
- With networking disabled, reopened SuiteMail: **six cached messages imported**, queue drained to zero, inbox rows visible. Original networking was restored afterward.
- Tested the real Accounts checkbox with touch input: disable and enable persisted. Background checks were left enabled.

The worker was exercised through an immediate debug dispatch rather than waiting for Android's discretionary 15-minute execution window. The recurring schedule was separately inspected in WorkManager's persisted database. Long-term battery/OEM behavior still needs physical-device testing. Notifications/push are not included.

### Safe native testing

Use the app-specific task, with preservation enabled:

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
  android/gradlew -p android :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.suitemail.app.BackgroundMailStoreTest \
  -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true
```

`android/gradle.properties` also enables this preservation option. During development the default root instrumentation task uninstalled the emulator app in cleanup and removed its local data. The existing device Google account was reconnected without a password/new grant, and recent mail restored from Gmail; older cached history is rebuilding. The corrected test configuration was verified with a private canary file surviving a complete test run. Use a disposable emulator for destructive/fixture tests, and do not run the root task for every Capacitor dependency.

To dispatch the real worker promptly on a signed-in development emulator, send the app to the background, then:

```sh
adb shell am broadcast -n com.suitemail.app/.BackgroundMailTestReceiver \
  -a com.suitemail.app.TEST_BACKGROUND_SYNC
```

For repeated cache-import testing, `--ez bootstrap true` resets only the worker's derived history state and replays its latest-inbox prefetch. It never deletes account or mail databases. The receiver requires the privileged DUMP permission used by adb shell, exists only in the debug manifest/source set, and is absent from release builds. Native worker code reads mail and does not send test emails or mutate server mail.

References: [WorkManager periodic intervals](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest), [persistent background work](https://developer.android.com/develop/background-work/background-tasks/persistent), [Google native authorization](https://developer.android.com/identity/authorization).
