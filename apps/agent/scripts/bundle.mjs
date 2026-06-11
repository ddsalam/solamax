#!/usr/bin/env node
/**
 * Buat bundle deploy Windows untuk mesin SPBU (lihat RUNBOOK-SPBU.md):
 *   apps/agent/bundle-out/
 *     solamax-agent.cjs     — seluruh agent + dependency dalam SATU file CJS,
 *                             di-transpile ke target Node 12 (Windows lama OK)
 *     config.local.json     — template config, diedit user di mesin SPBU
 *     1-tes-koneksi.bat     — dobel-klik: tes koneksi read-only
 *     2-dry-run.bat         — dobel-klik: tarik data & cetak ringkasan, TANPA kirim
 *     RUNBOOK-SPBU.md       — salinan runbook
 *   + apps/agent/solamax-agent-bundle.zip (bila `zip` tersedia)
 *
 * Jalankan dari root repo: pnpm --filter @solamax/agent bundle
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

try {
  execFileSync("zip", ["-rq", "solamax-agent-bundle.zip", "bundle-out"], {
    cwd: appDir,
  });
  console.log(`zip: ${resolve(appDir, "solamax-agent-bundle.zip")}`);
} catch {
  console.log("zip tidak tersedia — kompres folder bundle-out/ manual.");
}
console.log(`bundle siap: ${out}`);
