# Jade PIN Server

A self-hosted blind PIN oracle for the [Blockstream Jade](https://blockstream.com/jade/),
packaged as a desktop application that runs entirely offline.

Supports **QR PIN Unlock**, which makes it possible to use a Jade in a fully
air-gapped way — no USB, no Bluetooth, no network.

> Forked from [SimpleJadePinServer](https://github.com/Filiprogrammer/SimpleJadePinServer)
> by [Filiprogrammer](https://github.com/Filiprogrammer). The blind-oracle
> protocol implementation remains substantially theirs; this fork adds desktop
> packaging, offline hardening, camera fixes and key-management tooling.
> Not affiliated with or endorsed by Blockstream.

---

## Download

Grab the installer for your system from the [Releases page](../../releases):

| System | File |
|---|---|
| Linux | `Jade-PIN-Server-*.AppImage` |
| macOS (Apple Silicon) | `Jade-PIN-Server-*-arm64.dmg` |
| macOS (Intel) | `Jade-PIN-Server-*.dmg` |
| Windows | `Jade-PIN-Server-Setup-*.exe` |

Nothing else is required — no Python, no pip, no Docker, no certificates.

**Linux:** mark it executable and run it.

```bash
chmod +x Jade-PIN-Server-*.AppImage && ./Jade-PIN-Server-*.AppImage
```

**macOS:** the app is not signed with an Apple Developer certificate, so
Gatekeeper blocks it on first launch. Right-click the app and choose **Open**,
or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Jade PIN Server.app"
```

---

## Verifying your download

Each release ships a `SHA256SUMS` file.

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

Checksums alone only prove you received what was published — anyone able to
replace a binary could replace the checksum file beside it. The signature is
what proves the release came from us.

Import the release key, then verify:

```bash
curl -sO https://boltadvantage.com/pgp.asc && gpg --import pgp.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
```

The key is published on boltadvantage.com rather than only in this repository,
so it cannot be swapped by anyone who could swap these release files. Check the
fingerprint against the one listed there.

The signing key is never held by CI — releases are signed from an offline
machine, so a compromised workflow or third-party action cannot reach it.

You can also verify that a binary came from this repository's build workflow:

```bash
gh attestation verify <file> --repo boltadvantage/SimpleJadePinServer
```

**What these checks do and do not prove.** They prove you received the file that
was published, and that it was produced by this workflow from a specific commit.
They do **not** prove the binary corresponds byte-for-byte to the source in this
repository — Electron and PyInstaller builds are not reproducible, so an
independent rebuild will not produce an identical file. Anyone requiring that
guarantee should build from source and read the code.

---

## Runs entirely offline

This application makes no network requests of any kind. That is enforced in
three independent places:

- **No remote assets.** The QR scanning library is vendored into the repository.
  Upstream loaded it from a CDN, which is why scanning failed outright on
  air-gapped machines. Fonts are system fonts; nothing is fetched.
- **Content Security Policy.** The server sends a CSP restricting every resource
  class to `'self'`.
- **Process-level blocking.** The desktop shell cancels any request whose host is
  not loopback, so even a compromised page cannot originate outbound traffic.

The only listening socket is bound to `127.0.0.1` on a port chosen at startup.

---

## Where your keys live

| System | Location |
|---|---|
| macOS | `~/Library/Application Support/BoltJadePinServer` |
| Windows | `%APPDATA%\BoltJadePinServer` |
| Linux | `~/.local/share/BoltJadePinServer` |

The in-app **Keys & backup** page shows the exact path, your server public key,
and how many PIN records are stored.

```
BoltJadePinServer/
├── server_keys/
│   ├── private.key   ← the critical secret (0600)
│   └── public.key    ← derived; no separate backup needed
└── pins/
    └── <hash>.pin    ← encrypted PIN records
```

### What each file does

**`server_keys/private.key`** — the 32-byte static server private key. Your Jade
is configured to trust the public key derived from it, and your PIN records are
encrypted with a key derived from it.

**`pins/*.pin`** — the encrypted PIN records, one per wallet. This is what
actually releases the wallet key when the correct PIN is entered.

**Both are required.** Neither alone is enough. Lose either one and PIN unlock
stops working permanently for that wallet.

> **This is not a wallet backup.** It restores PIN unlock only. If you lose it,
> your funds are still recoverable from your BIP39 recovery phrase. That phrase
> remains the thing you must never lose.

### Backing up

Copy the whole data directory to encrypted offline media.

> **Keep it out of cloud sync and automatic backups.** The default location sits
> inside a folder that consumer backup tools capture by default. Your server
> private key guards PIN access to your wallet; uploading a copy to a third
> party quietly defeats the point of an air-gapped oracle. Check specifically
> for **Time Machine** (excludes are under System Settings → General → Time
> Machine → Options), **iCloud Drive** Desktop & Documents syncing, and
> **Google Drive / Dropbox / OneDrive** synced folders — these upload silently
> and retain deleted-file history. On Windows, OneDrive folder redirection often
> captures user folders near `%APPDATA%`.

> **Treat the backup like wallet material.** Anyone holding both it and your Jade
> gets unlimited PIN attempts, because restoring the files also restores the
> three-strikes counter.

### Moving an existing Jade to a new machine

A fresh install generates a **new** keypair, and a Jade configured against a
different key will not unlock. Do not re-scan the Oracle QR — that path requires
a factory reset, which erases the wallet.

Instead:

1. Quit the application completely.
2. Copy your backed-up `server_keys/` and `pins/` into the data directory above,
   replacing what was generated there.
3. Start the application again.
4. Open **Keys & backup** and confirm the server public key matches the one your
   Jade was configured with.

Or run against a backup in place without copying anything:

```bash
"Jade PIN Server" --data-dir /path/to/your/backup
```

### Upgrading from the original script

If a `key_data/` directory from the upstream SimpleJadePinServer is found in the
working directory or next to the application, it is imported automatically on
first run. The original is left untouched as a backup, and the import is
reported on the **Keys & backup** page.

---

## Using it

### Point your Jade at this server

Open **Oracle QR code**, click **Generate QR code**, then on the Jade click the
select button once as the logo appears to reach the boot menu, and choose
**Blind Oracle → Scan Oracle QR**.

![Jade boot menu](docs/images/jade_boot_menu_blind_oracle.png)
![Scan Oracle QR](docs/images/jade_blind_oracle_scan_qr.png)

Scan the generated code, then confirm the details on screen.

![Confirm PIN server](docs/images/jade_confirm_pin_server.png)

> The Jade must be uninitialized to set a new blind oracle. If yours is already
> set up, this requires a factory reset and restore from your recovery phrase.
> To migrate an existing setup, copy your keys across instead — see above.

If you only ever use the Jade in QR mode, the URL does not matter; the public key
is the only field that counts. The URL must be correct and reachable only for
firmware upgrades over USB or Bluetooth. (The Jade Plus can upgrade firmware
air-gapped via USB storage, so this does not apply to it.)

### QR mode

1. Enter your PIN on the Jade. It shows **Step 1/2** as a series of QR codes.
2. In the app, click **Start camera scan** and point the camera at the Jade.
   Progress is shown as frames are captured.
3. Click **Generate reply QR**, then scan it from the Jade's **Step 2/2** screen.

![Jade scanning Step 2/2](docs/images/jade_scanning_step2.png)

To unlock later, choose **QR Mode → QR PIN Unlock** on the Jade and repeat.

### If the camera does not work

The app reports the specific cause rather than failing silently, and offers two
fallbacks that need no camera at all:

- **Scan from image** — photograph the Jade screen and load the image.
- **Paste UR text** — enter the `ur:jade-pin/…` fragments directly.

Common causes on Linux: the browser is a snap or flatpak without the camera
interface connected (`snap connect firefox:camera`), or your user is not in the
`video` group. The desktop app avoids both, since it ships its own runtime.

### USB or Bluetooth mode

Use the Jade with Blockstream Green as normal. Green warns the first time that a
non-default blind oracle is in use — click **Advanced**, enable **Don't ask me
again for this oracle**, then **Allow Non-Default Connection**.

![Green non-default oracle warning](docs/images/green_non_default_oracle_warning_advanced.png)

---

## Running from source

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --require-hashes -r requirements.txt

npm ci --ignore-scripts
node node_modules/electron/install.js
npm start
```

To run only the server, without the desktop shell:

```bash
python3 SimpleJadePinServer.py --no-tls
```

| Option | Meaning |
|---|---|
| `--port N` | Port to listen on (default `4443`) |
| `--listen ADDR` | Bind address (default `127.0.0.1`) |
| `--data-dir PATH` | Override the key/PIN directory |
| `--no-tls` | Serve over HTTP. Safe on loopback, which browsers already treat as a secure context |

`--listen 0.0.0.0` exposes the oracle to your network. Only do that if Green or
the Jade must reach it from another host, and understand what you are exposing.

### Building installers

```bash
npm run dist
```

PyInstaller cannot cross-compile, so each platform must be built on its own
runner. The release workflow does this on an ephemeral CI matrix.

---

## Security notes

- `private.key` is written `0600`; its directory is `0700`.
- The web root is served with path-traversal protection; requests resolving
  outside it are rejected.
- The desktop shell runs the renderer with `contextIsolation`, `sandbox`, and no
  Node integration. The preload exposes exactly one method.
- Camera permission is granted only to the app's own loopback origin; every
  other permission, including microphone, is denied.
- `wallycore` — the cryptographic library that ships inside the binary — is
  installed with pinned SHA-256 hashes, so a substituted PyPI artifact fails the
  build.
- npm dependencies are installed from a committed lockfile with
  `--ignore-scripts`, blocking the lifecycle-script vector used by most npm
  supply-chain attacks. Electron's binary is verified against its published
  checksums.
- The release signing key is never stored in CI. Secrets in a build workflow
  are reachable by every third-party action it runs and by anyone with repo
  admin, so a key held there could not honestly attest to anything. Releases
  are published as drafts and signed from an offline machine
  (`scripts/sign-release.sh`), which re-derives the checksums from the actual
  artifacts and refuses to sign a manifest that does not match them.

Found a security issue? Email **security@boltadvantage.com**.

---

## Credits

Original implementation by [Filiprogrammer](https://github.com/Filiprogrammer)
([SimpleJadePinServer](https://github.com/Filiprogrammer/SimpleJadePinServer)),
whose work made air-gapped QR PIN unlock possible in the first place.

QR generation uses [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator);
QR scanning uses [html5-qrcode](https://github.com/mebjas/html5-qrcode), both
vendored locally.

Packaged and maintained by [Bolt Advantage](https://boltadvantage.com).

## License

**The upstream project does not carry a license file**, which means the original
code is by default "all rights reserved" under copyright. Forking and viewing it
on GitHub is permitted by GitHub's Terms of Service, but that does not grant a
right to redistribute — and publishing compiled binaries is redistribution.

This fork therefore does **not** assert a license over the inherited code, and
no license is claimed here on Filiprogrammer's behalf.

Modifications made in this fork (desktop packaging, offline hardening, camera
handling, key management, styling) are offered by Bolt Advantage, LLC under the
MIT license, to the extent they are separable from the original work.

If you are Filiprogrammer: we would be glad to see an explicit license on the
upstream project, and will comply with whatever you choose.
