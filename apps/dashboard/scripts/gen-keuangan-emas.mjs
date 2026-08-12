#!/usr/bin/env node
/**
 * Membangkitkan fixture KASUS EMAS keuangan dari berkas SEGEL T3.
 *
 *   node apps/dashboard/scripts/gen-keuangan-emas.mjs
 *
 * Sumbernya `session-notes/2026-08-10-keuangan-k0-t3-prareg.md` — pra-registrasi
 * yang di-commit (`27c9055`) SEBELUM satu pun sel jawaban workbook dibuka, dan
 * yang hasil diff-nya (`…-t3-hasil.md`) menunjukkan Gross Profit EKSAK 10/10
 * tanggal terhadap workbook Bakau.
 *
 * Kenapa dibangkitkan, bukan diketik: angka emas yang diketik ulang adalah angka
 * yang bisa salah ketik — dan salah ketiknya akan membuat uji regresi menuntut
 * hal yang keliru, diam-diam, selamanya. Skrip ini membuat fixture bisa
 * DIPERIKSA ULANG terhadap segelnya kapan saja.
 *
 * JANGAN menyunting JSON hasilnya dengan tangan. Kalau ia perlu berubah, yang
 * berubah mestinya segelnya — dan segel yang berubah bukan lagi segel.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SEAL = resolve(here, "../../../session-notes/2026-08-10-keuangan-k0-t3-prareg.md");
const OUT = resolve(here, "../src/lib/__fixtures__/keuangan-t3-emas.json");

/** "1,724.28" → 1724.28 · "" → null · "-0.00" → -0 (dinormalkan ke 0). */
const num = (raw) => {
  const t = String(raw).replace(/\*\*/g, "").trim();
  if (t === "") return null;
  const v = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(v)) throw new Error(`angka tak terbaca: ${JSON.stringify(raw)}`);
  return v === 0 ? 0 : v;
};

const md = readFileSync(SEAL, "utf8");
const dates = [];
const re = /^### (\d{4}-\d{2}-\d{2})$/gm;
const starts = [...md.matchAll(re)].map((m) => ({ date: m[1], at: m.index }));
if (starts.length !== 10) throw new Error(`harus 10 tanggal tersegel, dapat ${starts.length}`);

for (let i = 0; i < starts.length; i++) {
  const body = md.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : md.length);
  const rows = [];
  let totals = null;
  let grossProfit = null;

  for (const line of body.split("\n")) {
    const gp = line.match(/\*\*Gross Profit\*\*.*=\s*\*\*([-\d,.]+)\*\*/);
    if (gp) grossProfit = num(gp[1]);
    if (!line.startsWith("| ")) continue;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length !== 15) continue;
    if (c[0].startsWith("produk") || c[0].startsWith("---")) continue;

    if (c[0].includes("TOTAL")) {
      totals = {
        revenue: num(c[9]),
        cogs: num(c[10]),
        teraValue: num(c[11]),
        inventoryValue: num(c[12]),
        soValue: num(c[13]),
        lossesGainValue: num(c[14]),
      };
      continue;
    }
    const key = c[0].split(" ")[0]; // "BB-02 Pertamax" → "BB-02"
    rows.push({
      productKey: key,
      volume: num(c[1]),
      sellPrice: num(c[2]),
      tera: num(c[3]),
      stock: num(c[4]),
      lossesGain: num(c[5]),
      sisaSo: num(c[7]),
      buyPrice: num(c[8]),
      expected: {
        revenue: num(c[9]),
        cogs: num(c[10]),
        teraValue: num(c[11]),
        inventoryValue: num(c[12]),
        lossesGainValue: num(c[14]),
      },
    });
  }
  if (!totals) throw new Error(`baris TOTAL hilang di ${starts[i].date}`);
  if (grossProfit === null) throw new Error(`Gross Profit hilang di ${starts[i].date}`);
  dates.push({ date: starts[i].date, rows, totals, grossProfit });
}

const out = {
  _sumber: "session-notes/2026-08-10-keuangan-k0-t3-prareg.md (segel commit 27c9055)",
  _dibangkitkan_oleh: "apps/dashboard/scripts/gen-keuangan-emas.mjs",
  _peringatan: "JANGAN disunting tangan. Bangkitkan ulang dari segelnya.",
  dates,
};
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`OK — ${dates.length} tanggal, ${dates.reduce((n, d) => n + d.rows.length, 0)} baris produk → ${OUT}`);
