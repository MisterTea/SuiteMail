// SPDX-License-Identifier: GPL-3.0-or-later
//go:build android

//go:debug rsa1024min=0

package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/cookiejar"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/Masterminds/semver/v3"
	"github.com/ProtonMail/gluon/async"
	"github.com/ProtonMail/gluon/imap"
	"github.com/ProtonMail/go-proton-api"
	"github.com/ProtonMail/proton-bridge/v3/internal/bridge"
	"github.com/ProtonMail/proton-bridge/v3/internal/constants"
	"github.com/ProtonMail/proton-bridge/v3/internal/cookies"
	"github.com/ProtonMail/proton-bridge/v3/internal/dialer"
	"github.com/ProtonMail/proton-bridge/v3/internal/events"
	"github.com/ProtonMail/proton-bridge/v3/internal/locations"
	"github.com/ProtonMail/proton-bridge/v3/internal/sentry"
	"github.com/ProtonMail/proton-bridge/v3/internal/services/observability"
	"github.com/ProtonMail/proton-bridge/v3/internal/useragent"
	"github.com/ProtonMail/proton-bridge/v3/internal/vault"
	"github.com/ProtonMail/proton-bridge/v3/pkg/keychain"
	"github.com/sirupsen/logrus"
)

type privateLocations string

func (p privateLocations) UserConfig() string { return filepath.Join(string(p), "config") }
func (p privateLocations) UserData() string   { return filepath.Join(string(p), "data") }
func (p privateLocations) UserCache() string  { return filepath.Join(string(p), "cache") }

type request struct {
	Command         string
	Directory       string
	Key             string
	Email           string
	Password        string
	TOTP            string
	MailboxPassword string
}

type engine struct {
	*bridge.Bridge
	certificate string
	loaded      chan struct{}
}

var state struct {
	sync.Mutex
	*engine
}

func start(directory string, vaultKey []byte) (*engine, error) {
	logrus.SetLevel(logrus.ErrorLevel)
	if !filepath.IsAbs(directory) || len(vaultKey) != 32 {
		return nil, errors.New("invalid Android vault location or key")
	}
	version, err := semver.NewVersion(constants.Version)
	if err != nil {
		return nil, err
	}
	paths := locations.New(privateLocations(directory), constants.ConfigName)
	settings, err := paths.ProvideSettingsPath()
	if err != nil {
		return nil, err
	}
	cache, err := paths.ProvideGluonCachePath()
	if err != nil {
		return nil, err
	}
	panicHandler := async.NoopPanicHandler{}
	v, corrupt, err := vault.New(settings, cache, vaultKey, panicHandler)
	if err != nil {
		return nil, err
	}
	if corrupt != nil {
		return nil, errors.New("the Proton Bridge vault could not be unlocked")
	}
	if err = v.SetTelemetryDisabled(true); err != nil {
		return nil, err
	}
	if err = v.SetIMAPPort(0); err != nil {
		return nil, err
	}
	if err = v.SetSMTPPort(0); err != nil {
		return nil, err
	}
	if err = v.SetIMAPSSL(true); err != nil {
		return nil, err
	}
	if err = v.SetSMTPSSL(true); err != nil {
		return nil, err
	}
	if err = v.SetMaxSyncMemory(128 * 1024 * 1024); err != nil {
		return nil, err
	}

	certificate, err := configureLocalTLS(v)
	if err != nil {
		return nil, err
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	persistentJar, err := cookies.NewCookieJar(jar, v)
	if err != nil {
		return nil, err
	}
	identifier := useragent.New()
	pinnedDialer := dialer.NewPinningTLSDialer(
		dialer.NewBasicTLSDialer(constants.APIHost),
		dialer.NewTLSReporter(constants.APIHost, constants.AppVersion(version.Original()), identifier, dialer.TrustedAPIPins),
		dialer.NewTLSPinChecker(dialer.TrustedAPIPins),
	)
	proxy := dialer.NewProxyTLSDialer(pinnedDialer, constants.APIHost, panicHandler)
	apiURL, transport := apiConnection(constants.APIHost, dialer.CreateTransportWithDialer(proxy))
	var result *engine
	err = observability.WithObservability(paths, func(observabilityService *observability.Service) error {
		b, eventCh, err := bridge.New(paths, v, nil, nil, version, keychain.NewList(), observabilityService,
			apiURL, persistentJar, identifier, pinnedDialer, transport,
			proxy, panicHandler, sentry.NewReporter(constants.FullAppName, identifier), imap.DefaultEpochUIDValidityGenerator(),
			nil, false, false, false)
		if err != nil {
			return err
		}
		if b.GetIMAPPort() == 0 || b.GetSMTPPort() == 0 {
			b.Close(context.Background())
			return errors.New("the local Proton mail listeners could not start")
		}
		result = &engine{Bridge: b, certificate: certificate, loaded: make(chan struct{})}
		go func() {
			for event := range eventCh {
				if _, ok := event.(events.AllUsersLoaded); ok {
					select {
					case <-result.loaded:
					default:
						close(result.loaded)
					}
				}
			}
		}()
		return nil
	})
	return result, err
}

func (e *engine) login(ctx context.Context, r request) (bridge.UserInfo, error) {
	if info, err := e.QueryUserInfo(r.Email); err == nil && len(info.Addresses) != 0 {
		return info, nil
	}
	if r.Email == "" || r.Password == "" || r.Email == "crash@bandicoot" {
		return bridge.UserInfo{}, errors.New("enter your Proton email or username and password")
	}
	password := []byte(r.Password)
	defer clear(password)
	client, auth, err := e.LoginAuth(ctx, r.Email, password, nil)
	if err != nil {
		return bridge.UserInfo{}, err
	}

	handedOff := false
	defer func() {
		if !handedOff {
			cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = client.AuthDelete(cleanup)
		}
	}()
	if auth.TwoFA.Enabled&proton.HasTOTP != 0 {
		if r.TOTP == "" {
			return bridge.UserInfo{}, errors.New("enter your Proton authenticator code")
		}
		if err := client.Auth2FA(ctx, proton.Auth2FAReq{TwoFactorCode: r.TOTP}); err != nil {
			return bridge.UserInfo{}, errors.New("Proton did not accept the authenticator code")
		}
	} else if auth.TwoFA.Enabled != 0 {
		return bridge.UserInfo{}, errors.New("this build supports authenticator codes for Proton two-factor sign-in")
	}
	if auth.PasswordMode == proton.TwoPasswordMode {
		if r.MailboxPassword == "" {
			return bridge.UserInfo{}, errors.New("enter your separate Proton mailbox password")
		}
		password = []byte(r.MailboxPassword)
		defer clear(password)
	}
	// Bridge attaches the user's long-lived sync services to this context.
	// The JNI request deadline applies to authentication, not the user session.
	id, err := e.LoginUser(context.Background(), client, auth, password, nil)
	if err != nil {
		return bridge.UserInfo{}, err
	}
	handedOff = true
	return e.GetUserInfo(id)
}

func dispatch(r request) (any, error) {
	state.Lock()
	defer state.Unlock()
	if r.Command == "start" {
		if state.engine == nil {
			key, err := base64.StdEncoding.DecodeString(r.Key)
			if err != nil {
				return nil, errors.New("could not read the Proton vault key")
			}
			defer clear(key)
			state.engine, err = start(r.Directory, key)
			if err != nil {
				return nil, fmt.Errorf("could not start Proton Bridge: %w", err)
			}
		}
		return true, nil
	}
	if state.engine == nil {
		return nil, errors.New("Proton Bridge has not started")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	e := state.engine
	switch r.Command {
	case "status":
		return map[string]int{"imapPort": e.GetIMAPPort(), "smtpPort": e.GetSMTPPort()}, nil
	case "login":
		info, err := e.login(ctx, r)
		if err != nil {
			return nil, err
		}
		if len(info.Addresses) == 0 {
			return nil, errors.New("Proton returned no mail address")
		}
		return map[string]string{"email": info.Addresses[0]}, nil
	case "connection":
		select {
		case <-e.loaded:
		case <-ctx.Done():
			return nil, errors.New("Proton Bridge is still restoring accounts. Try again when online.")
		}
		info, err := e.QueryUserInfo(r.Email)
		if err != nil || len(info.BridgePass) == 0 {
			return nil, errors.New("sign in to your Proton account again from Add account")
		}
		return map[string]any{"password": string(info.BridgePass), "imapPort": e.GetIMAPPort(),
			"smtpPort": e.GetSMTPPort(), "certificate": e.certificate}, nil
	case "remove":
		for _, id := range e.GetUserIDs() {
			info, err := e.GetUserInfo(id)
			if err != nil {
				return nil, err
			}
			if len(info.Addresses) != 0 && strings.EqualFold(info.Addresses[0], r.Email) {
				return true, e.DeleteUser(ctx, id)
			}
		}
		return true, nil
	default:
		return nil, errors.New("unknown Proton Bridge command")
	}
}

//export SuiteMailProtonCall
func SuiteMailProtonCall(data *C.char, size C.int) (result *C.char) {
	defer func() {
		if fault := recover(); fault != nil {
			encoded, _ := json.Marshal(map[string]string{"error": panicMessage(fault)})
			result = C.CString(string(encoded))
		}
	}()
	var r request
	input := C.GoBytes(unsafe.Pointer(data), size)
	defer clear(input)
	if err := json.Unmarshal(input, &r); err != nil {
		return C.CString(`{"error":"Invalid Proton Bridge request"}`)
	}
	value, err := dispatch(r)
	response := map[string]any{"value": value}
	if err != nil {
		response = map[string]any{"error": err.Error()}
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		return C.CString(`{"error":"Could not encode Proton Bridge response"}`)
	}
	return C.CString(string(encoded))
}

func main() {}
