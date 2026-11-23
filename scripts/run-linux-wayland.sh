#!/usr/bin/env bash
# Runs a nested compositor in a disposable Linux test environment.
set -euo pipefail
if [[ ${SUITEMAIL_ISOLATED_DESKTOP_TEST:-} != 1 ]]; then
  echo 'Use this runner only in a disposable container/VM with SUITEMAIL_ISOLATED_DESKTOP_TEST=1.' >&2
  exit 1
fi
if [[ ${1:-} != --session ]]; then
  exec dbus-run-session -- bash "$0" --session "$@"
fi
shift
desktop=${1:?Expected gnome or kde}
shift
session_root=$(mktemp -d /tmp/suitemail-wayland-XXXXXX)
children=()
cleanup() {
  for child in "${children[@]}"; do kill "$child" 2>/dev/null || true; done
  for child in "${children[@]}"; do wait "$child" 2>/dev/null || true; done
  rm -rf -- "$session_root" || true
}
trap cleanup EXIT
export XDG_RUNTIME_DIR="$session_root/runtime"
export XDG_CONFIG_HOME="$session_root/config"
export XDG_DATA_HOME="$session_root/data"
export XDG_CACHE_HOME="$session_root/cache"
mkdir -m 700 -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
dbus-update-activation-environment XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR
export LIBGL_ALWAYS_SOFTWARE=1
export XDG_SESSION_TYPE=wayland
export WAYLAND_DISPLAY=suitemail-wayland
export SUITEMAIL_COMPOSITOR="$desktop"
export SUITEMAIL_COMPOSITOR_LOG="$session_root/compositor.log"
mkdir -p "$XDG_CONFIG_HOME/xdg-desktop-portal"
case "$desktop" in
  gnome)
    export XDG_CURRENT_DESKTOP=GNOME
    dbus-update-activation-environment WAYLAND_DISPLAY DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE
    printf '[preferred]\ndefault=gnome;gtk\n' > "$XDG_CONFIG_HOME/xdg-desktop-portal/portals.conf"
    # Allow compositor-state queries in this disposable shell only.
    extension="$XDG_DATA_HOME/gnome-shell/extensions/suitemail-test@local"
    mkdir -p "$extension"
    printf '%s\n' '{"uuid":"suitemail-test@local","name":"SuiteMail test queries","description":"Disposable test session","shell-version":["46","47","48","49","50"]}' > "$extension/metadata.json"
    printf '%s\n' 'export default class { enable() { global.context.unsafe_mode = true; } disable() { global.context.unsafe_mode = false; } }' > "$extension/extension.js"
    gsettings set org.gnome.shell enabled-extensions "['suitemail-test@local']"
    gsettings set org.gnome.desktop.interface enable-animations false
    if gnome-shell --help | grep -q -- --nested; then
      gnome-shell --nested --wayland --wayland-display="$WAYLAND_DISPLAY" --no-x11 > "$SUITEMAIL_COMPOSITOR_LOG" 2>&1 &
    else
      LIBGL_ALWAYS_SOFTWARE=1 gnome-shell --headless --virtual-monitor=1280x800 --wayland --wayland-display="$WAYLAND_DISPLAY" --no-x11 > "$SUITEMAIL_COMPOSITOR_LOG" 2>&1 &
    fi
    ;;
  kde)
    export XDG_CURRENT_DESKTOP=KDE
    dbus-update-activation-environment WAYLAND_DISPLAY DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE
    printf '[preferred]\ndefault=kde;gtk\n' > "$XDG_CONFIG_HOME/xdg-desktop-portal/portals.conf"
    QT_QPA_PLATFORM=xcb KWIN_COMPOSE=Q kwin_wayland --x11-display "$DISPLAY" --socket "$WAYLAND_DISPLAY" --width 1280 --height 800 --no-lockscreen --no-kactivities > "$SUITEMAIL_COMPOSITOR_LOG" 2>&1 &
    ;;
  *) echo 'Expected gnome or kde' >&2; exit 1 ;;
esac
children+=("$!")
for attempt in $(seq 1 150); do
  [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] && break
  kill -0 "${children[0]}" 2>/dev/null || { cat "$SUITEMAIL_COMPOSITOR_LOG"; exit 1; }
  sleep 0.1
done
[[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] || { cat "$SUITEMAIL_COMPOSITOR_LOG"; exit 1; }
if [[ "$desktop" == gnome ]]; then
  for attempt in $(seq 1 150); do
    kill -0 "${children[0]}" 2>/dev/null || { cat "$SUITEMAIL_COMPOSITOR_LOG"; exit 1; }
    reply=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval 'true' 2>/dev/null || true)
    [[ "$reply" == "(true, 'true')" ]] && break
    sleep 0.1
  done
  [[ "$reply" == "(true, 'true')" ]] || { cat "$SUITEMAIL_COMPOSITOR_LOG"; echo 'GNOME test-query extension did not become ready' >&2; exit 1; }
else
  for attempt in $(seq 1 150); do
    reply=$(gdbus introspect --session --dest org.kde.KWin --object-path /Scripting 2>/dev/null || true)
    [[ "$reply" == *loadScript* ]] && break
    kill -0 "${children[0]}" 2>/dev/null || { cat "$SUITEMAIL_COMPOSITOR_LOG"; exit 1; }
    sleep 0.1
  done
  [[ "$reply" == *loadScript* ]] || { cat "$SUITEMAIL_COMPOSITOR_LOG"; exit 1; }
fi
dbus-update-activation-environment WAYLAND_DISPLAY DISPLAY XDG_CURRENT_DESKTOP XDG_SESSION_TYPE XDG_RUNTIME_DIR XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME
portal_owned=$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.NameHasOwner org.freedesktop.portal.Desktop)
: > "$session_root/portal.log"
if [[ "$portal_owned" != '(true,)' ]]; then
  /usr/libexec/xdg-desktop-portal > "$session_root/portal.log" 2>&1 &
  children+=("$!")
fi
if ! "$@"; then
  cat "$SUITEMAIL_COMPOSITOR_LOG" "$session_root/portal.log"
  exit 1
fi
