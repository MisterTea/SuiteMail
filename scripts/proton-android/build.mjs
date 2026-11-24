import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function buildProtonBridge(root, ndkTools, abi, destination) {
  const bridge = path.join(root, 'submodules/proton-bridge');
  const android = path.join(root, 'scripts/proton-android');
  if (!fs.existsSync(path.join(bridge, 'go.mod'))) {
    throw new Error('Initialize submodules/proton-bridge before building Android Proton support.');
  }
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'suitemail-proton-android-'));
  try {
    fs.cpSync(bridge, stage, {
      recursive: true,
      filter: (source) => path.basename(source) !== '.git',
    });

    const desktop = path.join(stage, 'pkg/keychain');
    for (const name of ['helper_linux.go', 'helper_dbus_linux.go']) {
      const file = path.join(desktop, name);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('package keychain', '//go:build !android\n\npackage keychain'));
    }
    fs.copyFileSync(path.join(android, 'keychain.go'), path.join(desktop, 'helper_android.go'));
    const bridgeFile = path.join(stage, 'internal/bridge/bridge.go');
    const bridgeSource = fs.readFileSync(bridgeFile, 'utf8');
    const update = 'logPkg.Info("Checking for updates")';
    if (!bridgeSource.includes(update)) throw new Error('Bridge update integration must be refreshed.');
    fs.writeFileSync(bridgeFile, bridgeSource.replace(update, [
      'if runtime.GOOS == "android" {',
      '\t\t\treturn',
      '\t\t}',
      '\t\t' + update,
    ].join('\n')));

    const vaultFile = path.join(stage, 'internal/vault/vault.go');
    const vaultSource = fs.readFileSync(vaultFile, 'utf8');
    const reset = 'if corrupt != nil {\n\t\tnewEnc';
    if (!vaultSource.includes(reset)) throw new Error('Bridge vault integration must be refreshed.');
    const end = vaultSource.indexOf('\n\treturn &Vault{', vaultSource.indexOf(reset));
    if (end === -1) throw new Error('Bridge vault reset block must be refreshed.');
    fs.writeFileSync(vaultFile, vaultSource.slice(0, vaultSource.indexOf(reset)) +
      'if corrupt != nil {\n\t\treturn nil, corrupt, ErrDecryptFailed\n\t}\n' + vaultSource.slice(end));

    const command = path.join(stage, 'cmd/SuiteMail-Android');
    fs.mkdirSync(command);
    for (const name of ['main.go', 'tls.go', 'jni.c']) {
      fs.copyFileSync(path.join(android, name), path.join(command, name));
    }
    if (process.env.ANDROID_PROTON_FIXTURE === '1') {
      fs.copyFileSync(path.join(android, 'fixture.go'), path.join(command, 'fixture.go'));
    } else {
      fs.copyFileSync(path.join(android, 'production.go'), path.join(command, 'production.go'));
    }
    const [arch, triple] = abi === 'arm64-v8a'
      ? ['arm64', 'aarch64-linux-android'] : ['amd64', 'x86_64-linux-android'];
    const clang = path.join(ndkTools, process.platform === 'win32' ? 'clang.exe' : 'clang');
    const go = process.env.ANDROID_PROTON_GO || 'go';
    const result = spawnSync(go, [
      'build', '-mod=readonly', '-buildvcs=false', '-trimpath', '-buildmode=c-shared',
      '-ldflags', '-s -w -extldflags=-Wl,-z,max-page-size=16384 -X github.com/ProtonMail/proton-bridge/v3/internal/constants.Version=3.27.2+git',
      '-o', path.join(stage, 'libproton_android.so'), './cmd/SuiteMail-Android',
    ], {
      cwd: stage,
      env: { ...process.env, GOOS: 'android', GOARCH: arch, CGO_ENABLED: '1', CC: `"${clang}" --target=${triple}26` },
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error(`Android Proton Bridge build failed for ${abi}: ${result.error || result.status}`);
    fs.copyFileSync(path.join(stage, 'libproton_android.so'), path.join(destination, 'libproton_android.so'));
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
