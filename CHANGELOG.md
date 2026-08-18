# Changelog

## 1.0.1

Fixes USB and Bluetooth unlock, which did not work in 1.0.0.

- **USB/Bluetooth unlock now works.** The desktop app requested a random port on
  every launch. QR mode was unaffected, but Blockstream Green connects to the
  URL stored on the Jade — normally `http://127.0.0.1:4443` — so USB and
  Bluetooth unlock always failed. The app now binds 4443 when it is free and
  falls back to another port only if it is taken.
- **The address in use is now visible.** The Keys & backup page shows the
  server address and warns when it is not the standard port, which is exactly
  when USB and Bluetooth unlock will not work.
- **Malformed requests return an error instead of hanging.** Bad request bodies
  previously dropped the connection with no response, which was difficult to
  diagnose when Green was the client. They now return `400`.
- **Blocked DNS rebinding and cross-site requests.** The server did not check
  the `Host` header, so a web page whose domain was re-pointed at `127.0.0.1`
  became same-origin with it and could read responses, including the data
  directory path and server public key. Requests with a non-loopback `Host`, or
  a foreign `Origin`, are now refused. Private keys and PIN records were never
  reachable this way, and the wallet was never at risk.
- **Documentation.** Restored instructions for pointing the Jade at the server
  over a USB cable with `set_jade_pinserver.py`, which is the practical route
  when a camera cannot scan the Oracle QR. USB and Bluetooth unlock are now
  documented as supported methods rather than a footnote.

No changes to the blind-oracle protocol, key handling, or stored PIN records.
Upgrading is safe and your existing keys are untouched.

## 1.0.0

First release of the Bolt Advantage fork.

- Packaged as a desktop application for Linux, macOS and Windows, with no
  Python, pip, Docker or certificate setup required.
- Fixed QR scanning, which could not work on an air-gapped machine: the scanner
  library was loaded from a CDN, the server would not serve a local copy, and
  every failure was silently swallowed. The library is now bundled, static files
  are served properly, and failures report their cause. Image-file and
  manual-paste fallbacks work with no camera at all.
- Makes no network requests of any kind, enforced by a Content-Security-Policy
  and by the desktop shell cancelling any non-loopback request.
- Key material moved to a per-user application data directory, with automatic
  import of an existing `key_data/` directory so an already-configured Jade
  keeps working.
- Added a Keys & backup page documenting what each file is, how to back it up
  and how to restore onto another machine.
- Releases publish SHA-256 checksums, a detached signature made offline, and
  GitHub build provenance.
