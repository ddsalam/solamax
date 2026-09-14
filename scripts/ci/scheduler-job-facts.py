#!/usr/bin/env python3
"""Ekstrak fakta job Cloud Scheduler dari JSON `gcloud ... describe`, di stdin.

⚠️ KENAPA LEWAT BERKAS INI, dan bukan `--format` gcloud.
`--format` apa pun yang menyebut `httpTarget.headers` mencetak NILAI header —
termasuk `x-snapshot-secret`. Pada 14-09-2026 satu perintah `describe` seperti
itu membocorkan secret ke transkrip sesi dan memaksa rotasi. (`keys().list()`
BUKAN penggantinya: `keys` bukan transform gcloud yang sah — nasihat itu sempat
ditulis tanpa diuji, lalu dikoreksi.)

Berkas ini menerima JSON utuh di pipa dan mencetak HANYA tiga fakta yang
dibutuhkan gerbang: uri, nilai Content-Type, dan DAFTAR KUNCI header. Nilai
header lain tidak pernah keluar.

Keluarannya berbentuk `KEY=nilai-terkutip`, siap di-`eval` oleh shell.
"""
import base64
import json
import shlex
import sys


def main() -> None:
    try:
        parsed = json.load(sys.stdin) or {}
    except json.JSONDecodeError:
        parsed = {}
    target = parsed.get("httpTarget") or {}
    headers = target.get("headers") or {}
    # `body` di API adalah base64. Yang dibutuhkan gerbang hanya: apakah ia
    # MEMATOK satu unit. Job pemensiunan yang mematok unit_id mengulang persis
    # akar insiden 14-09-2026 — pemensiunan per-unit dengan penjadwal yang
    # hanya mencakup sebagian unit.
    pinned = ""
    raw = target.get("body")
    if raw:
        try:
            decoded = json.loads(base64.b64decode(raw).decode("utf-8"))
            if isinstance(decoded, dict) and decoded.get("unit_id") is not None:
                pinned = str(decoded["unit_id"])
        except (ValueError, UnicodeDecodeError):
            pinned = "?"  # tak terbaca: gerbang tidak boleh menganggapnya aman
    for key, value in (
        ("JOB_URI", target.get("uri", "")),
        ("JOB_CONTENT_TYPE", headers.get("Content-Type", "")),
        ("JOB_HEADER_KEYS", ",".join(sorted(headers))),
        ("JOB_BODY_UNIT", pinned),
    ):
        print(f"{key}={shlex.quote(value)}")


if __name__ == "__main__":
    main()
