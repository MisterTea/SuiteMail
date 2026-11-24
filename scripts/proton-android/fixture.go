// SPDX-License-Identifier: GPL-3.0-or-later
//go:build android

package main

import (
	"fmt"
	"github.com/ProtonMail/go-proton-api"
	"github.com/ProtonMail/go-proton-api/server"
	"github.com/ProtonMail/go-proton-api/server/backend"
	"github.com/ProtonMail/proton-bridge/v3/internal/user"
	"net/http"
	"runtime/debug"
	"time"
)

func apiConnection(_ string, _ http.RoundTripper) (string, http.RoundTripper) {
	backend.GenerateKey = backend.FastGenerateKey
	user.EventPeriod = time.Second
	user.EventJitter = 0
	fixture := server.New()
	for _, username := range []string{"sender", "recipient"} {
		if _, _, err := fixture.CreateUser(username, []byte("fixture-password")); err != nil {
			panic(err)
		}
	}
	// This transport exists only in the explicitly selected test build and
	// receives a fixed loopback URL belonging to the simulator above.
	return fixture.GetHostURL(), proton.InsecureTransport()
}

func panicMessage(fault any) string {
	return fmt.Sprintf("Proton Bridge failed: %v\n%s", fault, debug.Stack())
}
