# SuiteMail for iPhone

The iOS beta targets iOS 26 or later. It runs on compatible iPads in iPhone compatibility mode. It uses the shared SuiteMail interface, a bundled Rust mail backend, and a local SQLite database. Gmail and password or app-password IMAP/SMTP connect directly to their providers. IMAP/SMTP requires TLS and a trusted server certificate.

## Build and run

On an Apple silicon Mac with Xcode 26 or later, install the repository’s Node.js dependencies and the Rust targets.

```sh
npm ci
rustup target add aarch64-apple-ios aarch64-apple-ios-sim --toolchain stable
npm run dev:ios
```

Choose an iPhone simulator and run the **App** scheme. `npm run build:ios` prepares the packaged web files and the XCFramework without opening Xcode. Re-run it after changing the web app or Rust. The iOS bundle excludes the desktop Gmail client ID and client secret.

To run the iPhone UI smoke test, select a disposable iPhone simulator on iOS 26 or later. Use `xcrun simctl list devices available` to find its ID. The test enables the local sandbox account, searches its generated inbox, recovers a draft after relaunch, and sends it within the sandbox. Run the **App** scheme’s test action in Xcode, or use:

```sh
npm run build:ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -destination 'id=SIMULATOR_UDID' \
  -derivedDataPath ios/DerivedData -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
```

## Configure Google and signing

Create an **iOS** OAuth client for `com.suitemail.app` in the SuiteLeaf Google Cloud project. Enable the Gmail API, add the Gmail modify scope under Google Auth Platform, and allowlist named test users while the project is in Testing. Google expires these test grants after seven days.

Create the ignored file `ios/Signing.local.xcconfig` with the configuration for your team and client. Use the actual Google client ID and its reversed URL scheme from the Google Cloud console.

```xcconfig
DEVELOPMENT_TEAM = YOUR_APPLE_TEAM_ID
SUITEMAIL_GOOGLE_IOS_CLIENT_ID = YOUR_IOS_CLIENT_ID.apps.googleusercontent.com
SUITEMAIL_GOOGLE_IOS_REDIRECT_SCHEME = com.googleusercontent.apps.YOUR_IOS_CLIENT_ID
```

The iOS client is public and needs no OAuth client secret. Google sign-in uses the system authentication session. SuiteMail stores each Gmail grant in the device Keychain. Builds without a configured Google client can open the sandbox and connect to IMAP/SMTP.

## Sync and drafts

- Opening the app, returning to it, and pulling down in the inbox check for mail. Settings → Accounts shows the last successful sync.
- When iOS grants background time, SuiteMail can cache a page of Gmail changes for the next foreground sync. Foreground sync fetches the affected messages from Gmail and continues from the last successfully committed sync position. Background execution has no guaranteed schedule.
- Scheduled Gmail sends go out from native code (`BackgroundMail.swift`) both while the app is open (about once a minute and on resume) and from the background refresh task. A send is never early: a row is claimed only when its scheduled time has passed on the device clock. iOS decides when background refresh runs, so with the app closed a send can be late by a long time, and it does not run at all after the user force-quits the app until it is opened again. A send interrupted after reaching Gmail is marked failed rather than retried, so it is never sent twice.
- Drafts created on iOS are saved on the device. They appear under **On this device** in Drafts and survive app relaunch. When delivery is uncertain, check Sent before retrying.
- The picker uses the iOS Files interface. Supported attachments open in Quick Look, and export uses the iOS share sheet.

## Device and TestFlight verification

Install a signed build on an iPad with iPadOS 26 or later. Exercise Gmail sign-in and reconnect, outgoing IMAP/SMTP, account isolation and removal, Files and sharing, VoiceOver, and the background launch and expiration paths. Open and lock the device between sync attempts. Repeat the core flows with two Gmail accounts and a password-based IMAP account.

Archive the **App** scheme with the Apple Developer team and upload to the existing or newly registered App Store Connect record for `com.suitemail.app`. Check the archive’s privacy report, complete the encryption export answers, and add beta review information and a dedicated demo account. Start with internal testers. After beta approval, have an external tester verify a signed build on an iPhone before opening more invitations.
