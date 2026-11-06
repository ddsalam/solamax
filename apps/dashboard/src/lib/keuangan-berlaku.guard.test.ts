import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga TEKS — rencana 2026-11-07 KTD1: SATU aturan "baris manual_entry
 * berlaku" (`SQL_ME_TAK_BERLAKU`, `keuangan-berlaku.ts`).
 *
 * Memindai setiap template SQL di `src/` yang membaca `app.manual_entry`, lalu
 * menghitung saringan void MENTAH (`NOT m.void`, `NOT void`) atas alias tabel
 * itu. Hanya pembaca yang khusus baris PENGAWAS dan penjaga tulis yang boleh
 * memakainya — mereka terdaftar di bawah, per berkas, dengan alasannya.
 *
 * ⛔ Kalau uji ini merah karena berkas BARU atau hitungan BERTAMBAH: pembaca
 * uang memakai `NOT ${SQL_ME_TAK_BERLAKU("m")}` (atau `… AS void`), bukan
 * saringannya sendiri. Menambah angka di daftar ini adalah keputusan, bukan
 * perbaikan — tulis alasannya.
 */
const IZIN: Record<string, { n: number; alasan: string }> = {
  "lib/queries.ts": { n: 3, alasan: "Rincian/kepatuhan/anomali — baris pengawas saja (source_door='pengawas')" },
  "lib/keuangan-input-queries.ts": { n: 1, alasan: "getSetoranPengawas — setoran tunai pengawas" },
  "lib/keuangan-pantau-queries.ts": { n: 1, alasan: "setoran pengawas menunggu diposting" },
  "lib/setoran-tulis.ts": { n: 1, alasan: "jalur tulis setoran pengawas" },
  "lib/manual-entry-actions.ts": { n: 2, alasan: "jalur tulis/void pintu pengawas" },
  "lib/kas-actions.ts": { n: 3, alasan: "penjaga tulis + kaskade void mutasi kas → beban" },
  "lib/cocok-bank-actions.ts": { n: 2, alasan: "kaskade void batalkan cocok → beban" },
  "lib/tautan-actions.ts": { n: 2, alasan: "penjaga tulis tautan beban ↔ mutasi" },
  "lib/batal-balik-tulis.ts": { n: 1, alasan: "UPDATE bersyarat Batalkan — void sekali, tak menimpa void lain" },
};

const KATA_KUNCI = new Set([
  "where", "set", "on", "join", "left", "order", "group", "as", "using", "for", "limit",
  "union", "inner", "right", "full", "returning", "values",
]);

function* berkas(d: string): Generator<string> {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      if (f !== "node_modules") yield* berkas(p);
    } else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) yield p;
  }
}

/** Σ saringan void mentah atas alias `app.manual_entry` per berkas. */
export function hitungSaringanMentah(src: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of berkas(src)) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/`[^`]*`/gs)) {
      const t = m[0];
      if (!t.includes("app.manual_entry")) continue;
      const alias = new Set<string>();
      let tanpaAlias = false;
      for (const a of t.matchAll(/app\.manual_entry\b(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi)) {
        if (!a[1] || KATA_KUNCI.has(a[1].toLowerCase())) tanpaAlias = true;
        else alias.add(a[1]);
      }
      let n = 0;
      for (const al of alias) n += [...t.matchAll(new RegExp(`NOT\\s+${al}\\."?void"?\\b`, "g"))].length;
      if (tanpaAlias) n += [...t.matchAll(/NOT\s+"?void"?\b/g)].length;
      if (n > 0) {
        const k = relative(src, f);
        out[k] = (out[k] ?? 0) + n;
      }
    }
  }
  return out;
}

const SRC = resolve(__dirname, "..");

describe("satu aturan 'baris berlaku' (KTD1)", () => {
  it("penjaga ini punya SUBJEK — fragmen dipakai pembaca uang", () => {
    for (const f of [
      "lib/keuangan-laporan-queries.ts",
      "lib/buku-besar-sumber.ts",
      "lib/tautan-queries.ts",
      "lib/keuangan-input-queries.ts",
      "lib/keuangan-pantau-queries.ts",
      "app/(app)/keuangan/sumber-data/page.tsx",
    ]) {
      expect(readFileSync(join(SRC, f), "utf8"), f).toMatch(/SQL_ME_TAK_BERLAKU\("m"\)/);
    }
  });

  it("🔴 tak ada saringan void mentah atas manual_entry di luar daftar izin", () => {
    const nyata = hitungSaringanMentah(SRC);
    const harap = Object.fromEntries(Object.entries(IZIN).map(([k, v]) => [k, v.n]));
    expect(nyata).toEqual(harap);
  });
});
