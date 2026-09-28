#!/usr/bin/env python3
"""Rebuild the published page from the data in the repo.

    python3 tools/build_site.py

1. Empties the HISTORY constant in docs/index.html: the whole site now sits behind
   the lock, so the page itself carries no training data.
2. Encrypts the training log (data/private/workout_history.json) together with the
   health data (data/private/whoop.json and body.json) into docs/private.enc.json. The page decrypts it in the browser once the password
   is typed; the plaintext never enters the public repo.

The password is read from ~/.config/ai-fitness-coach/site-password, which is
created with a random value on first run. Change it by editing that file and
rebuilding.

Encryption: PBKDF2-SHA256 (600k iterations) stretches the password into an
AES-256-CBC key and an HMAC-SHA256 key; the HMAC over iv + ciphertext is checked
before anything is decrypted. AES runs through the openssl CLI because the
standard library has no cipher.
"""

import base64
import gzip
import hashlib
import hmac
import json
import os
import secrets
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY_JSON = os.path.join(ROOT, "data", "private", "workout_history.json")
PRIVATE = os.path.join(ROOT, "data", "private")
PAGE = os.path.join(ROOT, "docs", "index.html")
ENC_OUT = os.path.join(ROOT, "docs", "private.enc.json")
PASSWORD_FILE = os.path.expanduser("~/.config/ai-fitness-coach/site-password")
ITERATIONS = 600000


def password():
    if not os.path.exists(PASSWORD_FILE):
        os.makedirs(os.path.dirname(PASSWORD_FILE), exist_ok=True)
        with open(PASSWORD_FILE, "w") as f:
            f.write(secrets.token_urlsafe(9) + "\n")
        os.chmod(PASSWORD_FILE, 0o600)
        print("Yeni site şifresi oluşturuldu: " + PASSWORD_FILE)
    with open(PASSWORD_FILE) as f:
        return f.read().strip()


def openssl_aes(data, key, iv, decrypt=False):
    cmd = ["openssl", "enc", "-aes-256-cbc", "-K", key.hex(), "-iv", iv.hex(), "-nosalt"]
    if decrypt:
        cmd.append("-d")
    out = subprocess.run(cmd, input=data, capture_output=True, check=True)
    return out.stdout


def encrypt(payload, pw):
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(16)
    keys = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITERATIONS, 64)
    enc_key, mac_key = keys[:32], keys[32:]
    plain = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
    ct = openssl_aes(plain, enc_key, iv)
    mac = hmac.new(mac_key, iv + ct, hashlib.sha256).digest()
    # Round-trip before publishing: a blob the page can't open is worse than none.
    assert gzip.decompress(openssl_aes(ct, enc_key, iv, decrypt=True)) == gzip.decompress(plain)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS,
            "salt": b64(salt), "iv": b64(iv), "ct": b64(ct), "mac": b64(mac)}


def read_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_history():
    sessions = read_json(HISTORY_JSON, [])
    blob = "[]"
    with open(PAGE, encoding="utf-8") as f:
        page = f.read()
    start = page.index("var HISTORY = ")
    end = page.index("];", start) + 2
    page = page[:start] + "var HISTORY = " + blob + ";" + page[end:]
    with open(PAGE, "w", encoding="utf-8") as f:
        f.write(page)
    return sessions


def build_private(sessions):
    whoop = read_json(os.path.join(PRIVATE, "whoop.json"), None)
    body = read_json(os.path.join(PRIVATE, "body.json"), {"weight": [], "cardio": []})
    if whoop is None:
        print("data/private/whoop.json yok — önce tools/whoop_pull.py çalıştır.")
        return None
    payload = {"whoop": whoop, "body": body, "history": sessions}
    with open(ENC_OUT, "w") as f:
        json.dump(encrypt(payload, password()), f)
    return whoop


def main():
    sessions = build_history()
    whoop = build_private(sessions)
    print("sayfa: %d seans (son %s)" % (len(sessions), sessions[-1]["date"] if sessions else "—"))
    if whoop:
        print("şifreli veri: %d recovery, son çekim %s" % (len(whoop["recovery"]), whoop["pulled"]))


if __name__ == "__main__":
    main()
