# Linux desktop support

SuiteMail builds Linux x86-64 Debian packages and AppImages. The build baseline is
Ubuntu 22.04 (glibc 2.35); older distributions and musl/Alpine are unsupported.
Ubuntu 22.04 and 24.04 are the initial acceptance targets. Native Wayland checks
also cover GNOME 46 on Ubuntu 24.04, GNOME 50 on Ubuntu 26.04, and KDE Plasma 5.27.
These use disposable virtual desktop sessions; the full-session checks below
remain separate. ARM64, RPM, Flatpak and Snap are not
currently release targets.

## Installation

Download the `.deb` or `.AppImage` from the
[GitHub release](https://github.com/MisterTea/SuiteMail/releases/latest).

On Ubuntu/Debian, install the Debian package with apt so runtime dependencies are
resolved:

```sh
sudo apt install ./SuiteMail-*-linux-amd64.deb
```

For an AppImage, put it in a permanent, writable directory, then make it executable:

```sh
mkdir -p ~/Applications
mv SuiteMail-*-linux-x86_64.AppImage ~/Applications/SuiteMail.AppImage
chmod +x ~/Applications/SuiteMail.AppImage
~/Applications/SuiteMail.AppImage
```

AppImage needs the distribution's GTK 3, NSS, ALSA, GBM and X11 compatibility
libraries. FUSE 2 is needed by the normal AppImage launcher (`libfuse2` on Ubuntu
22.04; `libfuse2t64` on Ubuntu 24.04). If FUSE is unavailable, launch with
`APPIMAGE_EXTRACT_AND_RUN=1 ~/Applications/SuiteMail.AppImage`. Retain that
environment setting when configuring a launcher on a system without FUSE.
Launch as your regular user with the Chromium sandbox enabled. The automated
container tests use `--no-sandbox` and avoid Docker's small `/dev/shm`. The Xvfb
suite also disables GPU acceleration; the compositor suite uses software-rendered
native Wayland. These are test-harness settings, not installation instructions.

The Debian package installs `com.suitemail.app.desktop`, including the `mailto:`
association. Choose SuiteMail in your desktop's default mail application settings,
or run:

```sh
xdg-mime default com.suitemail.app.desktop x-scheme-handler/mailto
xdg-open 'mailto:someone@example.com?subject=Hello'
```

An AppImage alone does not install a desktop entry. To integrate it with the
desktop, copy the repository's `com.suitemail.app.desktop` to
`~/.local/share/applications/`, change `Exec` to your permanent AppImage path
followed by `%U`, and set `Icon` to an absolute path to the downloaded app icon.
Quote paths containing spaces according to the desktop-entry specification.
Run `update-desktop-database ~/.local/share/applications` and then the `xdg-mime`
command above. The desktop filename must stay `com.suitemail.app.desktop` for
Wayland shortcut permissions and window association.

## Desktop behavior

- Closing the Linux window minimizes it to the taskbar and keeps sync running.
  This works even if GNOME or another desktop does not display tray icons.
  Use Ctrl+Q while the window is focused, or Quit in the tray menu, to exit.
- Settings → General → Launch at login creates a per-user XDG autostart entry.
  Login startup omits the splash and settles into a minimized window. Moving an
  AppImage requires toggling this setting off and on to update the saved path.
- First startup allows up to 30 seconds for preparing the local profile. After a
  successful launch, the startup watchdog uses five seconds again. Navigation or
  preload failures still offer recovery immediately. Both deadlines are tested.
- The compose shortcut defaults to Ctrl+Shift+M. Conflicting shortcuts fail without
  replacing the previous working binding. On Wayland, desktop portal support and
  user permission are required; the desktop may control the final key binding.
  If a portal does not support global shortcuts, use the focused app's shortcuts.
  GNOME added the portal in [GNOME 48](https://release.gnome.org/48/developers/).
  For GNOME 42/46 on Ubuntu 22.04/24.04, another option is launching SuiteMail with
  `--ozone-platform=x11` to use XWayland. Missing portal support appears in Settings.
- Wayland controls focus activation. A real notification click or desktop launch
  can restore the app; an unsolicited background focus request may only request
  attention. See [Electron's platform notices](https://www.electronjs.org/docs/latest/api/browser-window#platform-notices).
- Notifications, tray appearance, taskbar badges and window activation are
  controlled in part by the desktop environment. A visible tray is optional.

## Updates and data

Release assets include `latest-linux.yml` alongside both packages. AppImage
updates replace the original AppImage, so its directory must be writable. Debian
updates use electron-updater's Debian installer and can request administrator
authentication. Installing a newer `.deb` manually with apt is also supported.
Never run the entire app as root to install an update.

The database, attachment cache and encryption key live under Electron's user data
directory (normally `$XDG_CONFIG_HOME/SuiteMail`, or `~/.config/SuiteMail`). Keep
the directory when upgrading. Uninstalling the package does not remove it.
Back up the whole directory together; the encryption key is required to read
saved credentials. Credentials currently use an application-managed key file,
not a GNOME Keyring/KWallet integration.

Proton Mail requires a separately installed, configured Proton Mail Bridge. The
release does not bundle Bridge. SuiteMail discovers standard Linux installations
and PATH binaries and connects to the local IMAP/SMTP ports using the Bridge
password. A working Bridge keychain and subscription are managed by Bridge.

## Development and automated verification

Use Node.js 24 and stable Rust. On Ubuntu 22.04:

```sh
sudo apt install build-essential pkg-config libgtk-3-0 libnss3 libasound2 \
  libgbm1 libxss1 libnotify4 libxtst6 libatk-bridge2.0-0 \
  xvfb dbus-x11 openbox desktop-file-utils xdotool
npm ci
npm run dev:desktop
npm run package
npm run test:electron
xvfb-run -a dbus-run-session -- npm run test:linux
```

CI builds current and next-patch packages and runs:

```sh
xvfb-run -a dbus-run-session -- npm run test:linux -- dist-electron dist-electron-update
```

This launches the packaged Debian and AppImage contents, validates desktop
metadata, checks cold/warm mailto launches, native shortcut dispatch, autostart,
minimized startup, Rust SQLite and filesystem persistence, and Proton Bridge
discovery with local test ports. Upgrade checks use a local feed, compare package
hashes, replace the AppImage and launch the updated contents with existing data.
Debian installation and package upgrades are additionally exercised by apt in CI.
The harness isolates HOME, XDG directories and update downloads; it never signs
into a real mail account. It requires a window manager (it starts Openbox) so
minimization can be checked under Xvfb.

The mail fixtures also exercise password authentication, folder listing, fetching
and parsing a complete MIME message, downloading an attachment, rejecting an
incorrect password, and SMTP delivery into a loopback-only sink. The fetched file
survives restart. They never forward mail or contact a provider.

CI additionally installs the same Debian package in disposable GNOME and KDE
containers and runs `scripts/run-linux-wayland.sh` with
`scripts/test-linux-wayland.mjs`. These force `--ozone-platform=wayland` and query
the compositor's window state: Electron's `isMinimized()` cannot reliably report
native Wayland state. The GNOME tests click an actual desktop notification and a
desktop launch control so activation tokens follow the real input path. GNOME 50
also cancels the first shortcut-consent request, approves a replacement, and
dispatches native key events to open Compose.

The session runner is guarded by `SUITEMAIL_ISOLATED_DESKTOP_TEST=1` and is for
disposable containers/VMs. It creates private D-Bus and XDG state and enables a
GNOME query extension only in that test shell. This extension is not part of the
app. Reports go to `SUITEMAIL_DESKTOP_REPORT_DIR` (default: `test-results`). See the
`linux-wayland` matrix in `.github/workflows/ci.yml` for complete dependency and
bootstrap commands.

To run the CI workflow locally with `nektos/act` and Docker, map each hosted
runner to the matching Ubuntu image and enable the artifact server so the
Wayland jobs can download the package built by `linux-desktop`:

```sh
act push -W .github/workflows/ci.yml \
  -P ubuntu-latest=catthehacker/ubuntu:act-latest \
  -P ubuntu-22.04=catthehacker/ubuntu:act-22.04 \
  -P ubuntu-24.04=catthehacker/ubuntu:act-24.04 \
  --container-options '--shm-size=1g' \
  --artifact-server-path /tmp/suitemail-act-artifacts
```

The Wayland containers bootstrap Node before JavaScript actions run; the
`setup-node` action then selects Node 24 for the tests. On Windows, use a
standalone clone for `act`: a linked worktree's `.git` file references a host
path that is unavailable inside the Linux container.

## Desktop release acceptance

The automated tests cover virtual GNOME/KDE sessions and local mail servers.
They do not certify a full login session, hardware rendering, or a real provider.
Record distribution, desktop, session type, package format and version for each
test run. Before claiming those environments are verified, check:

- Install and launch from the application menu; verify icon grouping, scaling,
  custom titlebar, dialogs, dragging/resizing and external browser links.
- Set the default mail app; open mailto links both with SuiteMail stopped and
  already running. Check recipients, subject and body appear once.
- Enable login startup, log out/in and verify the app stays minimized. Disable
  it and verify it no longer starts. Test without a tray extension.
- Register/rebind the compose shortcut, accept/deny Wayland portal permission,
  trigger from another app, test a conflicting binding and restart.
- Sign into Gmail with browser OAuth and into IMAP/SMTP; sync, send, receive,
  save/open attachments, restart, and verify credentials and messages persist.
- With a real Proton Bridge running, connect using its Bridge password, sync,
  send and receive; restart Bridge and verify reconnection.
- Receive a notification while minimized, click it and verify the correct
  account/thread opens. Check quiet hours and notification permission denial.
- Update from the previous released AppImage and `.deb`; verify the admin prompt
  for Debian, application restart, version and retained accounts/data.

Mark results as pending until run. Release CI gates package startup; publishing
does not imply these interactive checks passed.

## Verification record (2026-11-22)

The Linux native backend and both package formats were built in an isolated
Debian 12 container. Package smoke tests passed under Xvfb/Openbox on Debian 12,
Ubuntu 22.04 and Ubuntu 24.04. This verifies the generated native addon also loads
on the Ubuntu 22.04 baseline. The Debian package was installed with apt on Ubuntu
22.04 and its generated desktop entry passed `desktop-file-validate`.

The automated checks covered cold/warm mailto links, an actual X11 compose
shortcut, close/minimize and notification restoration, hidden startup, persistent
SQLite data and attachment files, autostart enable/disable, and local Proton
Bridge executable/config discovery and TCP banner probes. The mock Bridge tests
do not certify authentication or sending through a real Bridge account.

A synthetic 0.1.1 → 0.1.2 upgrade passed for both formats: the packaged updater
found the local feed, downloaded the correct file, verified its hash, and the
new version retained the database. The AppImage replacement itself was exercised;
Debian installation/upgrade was exercised separately with apt. Test versions were
not published and the source package version was not incremented.

Further isolated validation exercised real GNOME 46 and GNOME 50 compositors and
KWin 5.27 with native Wayland clients. It found and fixed a KWin startup bug:
minimizing before the first mapped frame left `--hidden` launches visible. A
pending startup minimize is now canceled when a link or notification activates
the window. Activation requests are issued once per launch so one-use Wayland
tokens are not consumed by redundant show/focus calls.

A desktop-launch test also exposed an ESM startup race: a second process could
create windows from an already-resolved ready callback after losing the instance
lock. The ready callback now exits immediately in that case. The Wayland harness
checks that the secondary process terminates after forwarding its URL.

GNOME's actual notification-click and desktop-launch paths passed, as did the
GNOME 50 shortcut-consent cancel/approve flow and native key dispatch while a
separate GTK application held keyboard focus. GNOME 46's
missing shortcut portal is detected and reported. The local IMAP/SMTP fixture
also passed authentication, fetch, attachment download, rejected credentials,
SMTP delivery and attachment persistence checks in both package formats.

The full frontend suite (2,172 passed, five skipped), ten Electron integration
tests, focused shortcut and notification tests, and production TypeScript/build
checks passed. Live-provider OAuth/send/receive and real Proton accounts are intentionally excluded at the
user's request. Full-session login/logout, hardware rendering and desktop
administrator authentication remain manual acceptance checks.

Cold-profile installer tests also exposed a false startup error while database
preparation was still progressing. The first successful launch now has a bounded
30-second grace period. A separate real-Electron test verifies healthy startup,
immediate load-error recovery, the five-second existing-profile timeout, and the
first-run grace followed by recovery at 30 seconds.

On 2026-11-23, `nektos/act` passed Test & Lint, Linux packages and upgrades,
the Linux release build/smoke tests, and all three Wayland matrix entries. The
initial Wayland run exposed the missing Node runtime in plain Ubuntu containers;
the workflow now bootstraps it before JavaScript actions. The corrected Wayland
jobs were rerun against the package artifact from the successful package job.
