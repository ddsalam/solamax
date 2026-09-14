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
    for key, value in (
        ("JOB_URI", target.get("uri", "")),
        ("JOB_CONTENT_TYPE", headers.get("Content-Type", "")),
        ("JOB_HEADER_KEYS", ",".join(sorted(headers))),
    ):
        print(f"{key}={shlex.quote(value)}")


if __name__ == "__main__":
    main()
