#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Capacitor generates .v26 with a Swift 5.9 manifest, where .v26 is unavailable.
sed -i '' 's/\.iOS(\.v26)/.iOS("26.0")/' ios/App/CapApp-SPM/Package.swift

export IPHONEOS_DEPLOYMENT_TARGET=26.0
export RUSTC="$(rustup which rustc)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}"
mkdir -p "$CARGO_TARGET_DIR" ios/App/Native
CARGO_TARGET_DIR="$(cd "$CARGO_TARGET_DIR" && pwd)"
rustup run stable cargo build --locked --release -p supermail_ios \
  --target aarch64-apple-ios --target aarch64-apple-ios-sim

framework=ios/App/Native/SuiteMailCore.xcframework
rm -rf "$framework"
xcodebuild -create-xcframework \
  -library "$CARGO_TARGET_DIR/aarch64-apple-ios/release/libsupermail_ios.a" -headers crates/supermail-ios/include \
  -library "$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/libsupermail_ios.a" -headers crates/supermail-ios/include \
  -output "$framework"
