// SPDX-License-Identifier: GPL-3.0-or-later
//go:build android

package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"net"
	"time"

	"github.com/ProtonMail/proton-bridge/v3/internal/vault"
)

// Mint a fresh trust root and server identity for this process. Only the
// leaf certificate and key go into the encrypted Bridge vault.
func configureLocalTLS(v *vault.Vault) (string, error) {
	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", err
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", err
	}
	now := time.Now()
	root := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "SuiteMail local Proton Bridge"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(1, 0, 0),
		KeyUsage: x509.KeyUsageCertSign, BasicConstraintsValid: true, IsCA: true, MaxPathLenZero: true,
	}
	leaf := &x509.Certificate{
		SerialNumber: big.NewInt(2), IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1)},
		NotBefore: root.NotBefore, NotAfter: root.NotAfter,
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, root, root, &rootKey.PublicKey, rootKey)
	if err != nil {
		return "", err
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, root, &leafKey.PublicKey, rootKey)
	if err != nil {
		return "", err
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(leafKey)
	if err != nil {
		return "", err
	}
	defer clear(privateDER)
	if err := v.SetBridgeTLSCertKey(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER}),
	); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(rootDER), nil
}
