// SPDX-License-Identifier: GPL-3.0-or-later
//go:build android

package keychain

// The Android frontend supplies the vault key directly from its Keystore.
func listHelpers() (Helpers, string) {
	return make(Helpers), ""
}
