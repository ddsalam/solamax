#!/usr/bin/env node
/**
 * Buat bundle deploy Windows untuk mesin SPBU (lihat RUNBOOK-SPBU.md):
 *   apps/agent/bundle-out/
 *     solamax-agent.cjs     — seluruh agent + dependency dalam SATU file CJS,
 *                             di-transpile ke target Node 12 (Windows lama OK)
 *     config.local.json     — template config, diedit user di mesin SPBU
 *     1-tes-koneksi.bat     — dobel-klik: tes koneksi read-only
 *     2-dry-run.bat         — dobel-klik: tarik data & cetak ringkasan, TANPA kirim
 *     jalankan-agent.bat    — target Task Scheduler (loop, log → logs\agent-<tgl>.log)
 *     resync-bulanan.bat    — task bulanan --resync-sales jendela 40 hari (unit
 *                             kelas NULL-by-default DTGLJAM, mis. AS 6478101;
 *                             aman utk semua unit — UPSERT idempoten)
 *     RUNBOOK-SPBU.md       — salinan runbook
 *   + apps/agent/solamax-agent-bundle.zip (bila `zip` tersedia) — isi FLAT,
 *     tanpa folder bundle-out/ (defect onboarding AS 2026-07-17: zip nested
 *     membuat file "tak terlihat" di C:\solamax-agent).
 *
 * Jalankan dari root repo: pnpm --filter @solamax/agent bundle
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(appDir, "bundle-out");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [resolve(appDir, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  // Node 12: jalan di Windows 7-era; sintaks modern di-transpile turun.
  target: ["node12"],
  outfile: resolve(out, "solamax-agent.cjs"),
  alias: {
    "@solamax/shared": resolve(appDir, "../../packages/shared/src/index.ts"),
  },
  // require opsional di dalam mysql2 (pretty-print debug) — tak dipakai.
  external: ["cardinal"],
  logLevel: "info",
});

cpSync(resolve(appDir, "config.example.json"), resolve(out, "config.local.json"));
cpSync(resolve(appDir, "RUNBOOK-SPBU.md"), resolve(out, "RUNBOOK-SPBU.md"));

// File .bat ditulis dengan CRLF (aman untuk cmd.exe lama).
const bat = (lines) => lines.join("\r\n") + "\r\n";

writeFileSync(
  resolve(out, "1-tes-koneksi.bat"),
  bat([
    "@echo off",
    'cd /d "%~dp0"',
    "echo === SolaMax Agent - TES KONEKSI (read-only, aman saat pompa beroperasi) ===",
    "node --version > output-tes-koneksi.txt 2>&1",
    "node solamax-agent.cjs --test-connection --config config.local.json >> output-tes-koneksi.txt 2>&1",
    "type output-tes-koneksi.txt",
    "echo.",
    "echo ^>^>^> Hasil tersimpan di output-tes-koneksi.txt - kirimkan isi file ini.",
    "pause",
  ]),
);

writeFileSync(
  resolve(out, "2-dry-run.bat"),
  bat([
    "@echo off",
    'cd /d "%~dp0"',
    "echo === SolaMax Agent - DRY RUN (baca data, TIDAK kirim ke mana pun) ===",
    "node --version > output-dry-run.txt 2>&1",
    "node solamax-agent.cjs --dry-run --once --config config.local.json >> output-dry-run.txt 2>&1",
    "type output-dry-run.txt",
    "echo.",
    "echo ^>^>^> Hasil tersimpan di output-dry-run.txt - kirimkan isi file ini.",
    "pause",
  ]),
);

writeFileSync(
  resolve(out, "3-sync-once.bat"),
  bat([
    "@echo off",
    'cd /d "%~dp0"',
    "echo === SolaMax Agent - SYNC SEKALI (kirim ke backend; baca DB tetap read-only) ===",
    "echo Run pertama = backfill penuh, bisa beberapa menit. Jangan tutup jendela.",
    "node --version > output-sync-once.txt 2>&1",
    "node solamax-agent.cjs --once --config config.local.json >> output-sync-once.txt 2>&1",
    "type output-sync-once.txt",
    "echo.",
    "echo ^>^>^> Hasil tersimpan di output-sync-once.txt - kirimkan isi file ini.",
    "pause",
  ]),
);

writeFileSync(
  resolve(out, "4-probe11-saldo.bat"),
  bat([
    "@echo off",
    'cd /d "%~dp0"',
    "echo === SolaMax Agent - PROBE 11 SALDO (read-only, aman saat pompa beroperasi; TIDAK kirim) ===",
    "node --version > output-probe11-saldo.txt 2>&1",
    "node solamax-agent.cjs --probe11 --config config.local.json >> output-probe11-saldo.txt 2>&1",
    "type output-probe11-saldo.txt",
    "echo.",
    "echo ^>^>^> Hasil tersimpan di output-probe11-saldo.txt - kirimkan isi file ini.",
    "pause",
  ]),
);

writeFileSync(
  resolve(out, "5-probe12-saldo.bat"),
  bat([
    "@echo off",
    'cd /d "%~dp0"',
    "echo === SolaMax Agent - PROBE 12 SALDO koreksi (read-only, aman saat pompa; TIDAK kirim) ===",
    "node --version > output-probe12-saldo.txt 2>&1",
    "node solamax-agent.cjs --probe12 --config config.local.json >> output-probe12-saldo.txt 2>&1",
    "type output-probe12-saldo.txt",
    "echo.",
    "echo ^>^>^> Hasil tersimpan di output-probe12-saldo.txt - kirimkan isi file ini.",
    "pause",
  ]),
);

writeFileSync(
  resolve(out, "6-probe13-saldo.bat"),
  bat([
    "@echo off",
    'cd /d "%~dp0"',
    "echo === SolaMax Agent - PROBE 13 SALDO decisive (read-only, aman saat pompa; TIDAK kirim) ===",
    "node --version > output-probe13-saldo.txt 2>&1",
    "node solamax-agent.cjs --probe13 --config config.local.json >> output-probe13-saldo.txt 2>&1",
    "type output-probe13-saldo.txt",
    "echo.",
    "echo ^>^>^> Hasil tersimpan di output-probe13-saldo.txt - kirimkan isi file ini.",
    "pause",
  ]),
);

// jalankan-agent.bat — target Task Scheduler. Sebelumnya TIDAK pernah ikut
// bundle (dibuat tangan di IB, disalin turun-temurun; ketahuan saat onboarding
// AS). Loop tanpa --once; stdout agent di-redirect ke logs\agent-<tgl>.log
// (agent menulis ke stdout — tanpa redirection TIDAK ada log lokal).
writeFileSync(
  resolve(out, "jalankan-agent.bat"),
  bat([
    "@echo off",
    'cd /d "%~dp0"',
    "if not exist logs mkdir logs",
    "for /f %%i in ('powershell -NoProfile -Command \"Get-Date -Format yyyy-MM-dd\"') do set TGL=%%i",
    'node solamax-agent.cjs --config config.local.json >> "logs\\agent-%TGL%.log" 2>&1',
  ]),
);

// resync-bulanan.bat — task bulanan --resync-sales (hari-ini−40 .. hari-ini).
// STANDAR unit kelas NULL-by-default DTGLJAM (AS 6478101): sales 100% lewat
// rescan 7-hari, back-dating >7 hari hanya terheal lewat resync ini. Aman
// berjalan bersamaan loop agent (MySQL read-only + UPSERT idempoten).
writeFileSync(
  resolve(out, "resync-bulanan.bat"),
  bat([
    "@echo off",
    'cd /d "%~dp0"',
    "if not exist logs mkdir logs",
    "for /f %%i in ('powershell -NoProfile -Command \"Get-Date -Format yyyy-MM-dd\"') do set HARIINI=%%i",
    "for /f %%i in ('powershell -NoProfile -Command \"(Get-Date).AddDays(-40).ToString('yyyy-MM-dd')\"') do set AWAL=%%i",
    'echo [%HARIINI%] resync-bulanan %AWAL% s/d %HARIINI% >> "logs\\resync-bulanan.log"',
    'node solamax-agent.cjs --resync-sales %AWAL% %HARIINI% --config config.local.json >> "logs\\resync-bulanan.log" 2>&1',
  ]),
);

try {
  // -j (junk paths): entri zip FLAT — ekstrak langsung menaruh file di target,
  // tanpa subfolder bundle-out/ (lihat catatan defect di header). Zip lama
  // dihapus dulu: `zip` meng-update arsip yang ada (entri nested basi bertahan).
  rmSync(resolve(appDir, "solamax-agent-bundle.zip"), { force: true });
  execFileSync(
    "zip",
    ["-jq", resolve(appDir, "solamax-agent-bundle.zip"), ...readdirSync(out).map((f) => resolve(out, f))],
    { cwd: appDir },
  );
  console.log(`zip: ${resolve(appDir, "solamax-agent-bundle.zip")}`);
} catch {
  console.log("zip tidak tersedia — kompres folder bundle-out/ manual.");
}
console.log(`bundle siap: ${out}`);
