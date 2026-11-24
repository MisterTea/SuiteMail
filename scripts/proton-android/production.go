// SPDX-License-Identifier: GPL-3.0-or-later
//go:build android

package main

import "net/http"

func apiConnection(url string, transport http.RoundTripper) (string, http.RoundTripper) {
	return url, transport
}

func panicMessage(any) string { return "Proton Bridge failed" }
