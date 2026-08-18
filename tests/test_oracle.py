#!/usr/bin/env python3
"""End-to-end test of the blind PIN oracle.

Plays the client half of the protocol the same way a Jade does, against a
running server, and asserts the security properties that matter:

  * set_pin then get_pin with the correct PIN returns the same wallet key
  * a wrong PIN does not return that key
  * three wrong attempts destroy the record (anti-brute-force)
  * a replayed counter is rejected

Run with the server already listening:

    python3 SimpleJadePinServer.py --no-tls --port 4470 --data-dir /tmp/t &
    python3 tests/test_oracle.py http://127.0.0.1:4470
"""

import base64
import json
import os
import sys
import urllib.request
from hashlib import sha256

import wallycore as wally

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4470"

failures = []


def check(name, cond):
    print(("  PASS  " if cond else "  FAIL  ") + name)
    if not cond:
        failures.append(name)


def post(path, data_b64):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps({"data": data_b64}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def server_pubkey():
    with urllib.request.urlopen(BASE + "/status") as r:
        return bytes.fromhex(json.load(r)["public_key"])


def make_client_keys():
    """A per-wallet 'pin' keypair, as the Jade holds."""
    while True:
        priv = bytearray(os.urandom(32))
        try:
            wally.ec_private_key_verify(priv)
            return priv, wally.ec_public_key_from_private_key(priv)
        except Exception:
            pass


def tweaked_server_pubkey(srv_pub, replay_counter, cke):
    """Mirror the server's BIP341 tweak so we derive the same shared secret."""
    tweak = sha256(wally.hmac_sha256(cke, replay_counter)).digest()
    return wally.ec_public_key_bip341_tweak(srv_pub, tweak, 0)


def call(path, pin_priv, pin_pub, pin_secret, counter, entropy=None):
    srv_pub = server_pubkey()

    # Ephemeral client key ("cke") for this exchange.
    while True:
        eph_priv = bytearray(os.urandom(32))
        try:
            wally.ec_private_key_verify(eph_priv)
            break
        except Exception:
            pass
    cke = wally.ec_public_key_from_private_key(eph_priv)

    replay_counter = counter.to_bytes(4, "little")
    srv_tweaked = tweaked_server_pubkey(srv_pub, replay_counter, cke)

    if entropy is not None:
        signed = bytearray(sha256(cke + replay_counter + pin_secret + entropy).digest())
        sig = wally.ec_sig_from_bytes(
            pin_priv, signed, wally.EC_FLAG_ECDSA | wally.EC_FLAG_RECOVERABLE)
        payload = pin_secret + entropy + sig
    else:
        signed = bytearray(sha256(cke + replay_counter + pin_secret).digest())
        sig = wally.ec_sig_from_bytes(
            pin_priv, signed, wally.EC_FLAG_ECDSA | wally.EC_FLAG_RECOVERABLE)
        payload = pin_secret + sig

    iv = os.urandom(16)
    encrypted = wally.aes_cbc_with_ecdh_key(
        eph_priv, iv, payload, srv_tweaked, b"blind_oracle_request",
        wally.AES_FLAG_ENCRYPT)

    resp = post(path, base64.b64encode(cke + replay_counter + encrypted).decode())
    blob = base64.b64decode(resp["data"])

    decrypted = wally.aes_cbc_with_ecdh_key(
        eph_priv, None, blob, srv_tweaked, b"blind_oracle_response",
        wally.AES_FLAG_DECRYPT)

    # Server returns hmac(server_key, pin_secret); unwrap to the wallet key.
    return decrypted


def main():
    print(f"\nTesting oracle at {BASE}\n")

    pin_priv, pin_pub = make_client_keys()
    pin_secret = os.urandom(32)
    wrong_secret = os.urandom(32)
    entropy = os.urandom(32)

    # 1. set_pin establishes the record.
    key_set = call("/set_pin", pin_priv, pin_pub, pin_secret, 1, entropy)
    check("set_pin returns a 32-byte key", len(key_set) == 32)

    # 2. Correct PIN returns the same key.
    key_get = call("/get_pin", pin_priv, pin_pub, pin_secret, 2)
    check("correct PIN returns the SAME key as set_pin", key_get == key_set)

    # 3. Wrong PIN must not return it.
    key_bad = call("/get_pin", pin_priv, pin_pub, wrong_secret, 3)
    check("wrong PIN does NOT return the key", key_bad != key_set)

    # 4. Correct PIN still works, and resets the attempt counter.
    key_ok = call("/get_pin", pin_priv, pin_pub, pin_secret, 4)
    check("correct PIN works again after one failure", key_ok == key_set)

    # 5. Three consecutive wrong attempts destroy the record.
    for i in range(3):
        call("/get_pin", pin_priv, pin_pub, wrong_secret, 5 + i)
    key_after = call("/get_pin", pin_priv, pin_pub, pin_secret, 9)
    check("record destroyed after 3 wrong attempts", key_after != key_set)

    # 6. Replay protection: a counter at or below the stored one is refused.
    pin_priv2, pin_pub2 = make_client_keys()
    secret2 = os.urandom(32)
    k1 = call("/set_pin", pin_priv2, pin_pub2, secret2, 1, os.urandom(32))
    call("/get_pin", pin_priv2, pin_pub2, secret2, 50)
    replayed = None
    try:
        replayed = call("/get_pin", pin_priv2, pin_pub2, secret2, 10)
    except Exception:
        pass
    check("replayed (lower) counter does not return the key",
          replayed is None or replayed != k1)

    print()
    if failures:
        print(f"{len(failures)} FAILED: {failures}")
        sys.exit(1)
    print("All oracle protocol tests passed.")


if __name__ == "__main__":
    main()
