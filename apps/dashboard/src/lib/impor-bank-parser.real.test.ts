/**
 * Uji ber-gerbang env pada e-statement BCA ASLI (U8, Definition of Done
 * "uji parser real 18/18"). Berkas asli tidak pernah masuk repo:
 *
 *   REKENING_KORAN_DIR="/…/Rekening Koran" \
 *     pnpm --filter @solamax/dashboard exec vitest run src/lib/impor-bank-parser.real
 *
 * Tiap PDF: `pdftotext` (lewat `pdf-teks.ts`) → parser → validasi kaki harus
 * lolos. Bila `python3` ada, keluaran juga dibandingkan baris-per-baris
 * (tanggal + nominal sen bertanda) dengan simulasi `parse_rk.py` di aset plan.
 * Keterangan tidak dibandingkan: versi Python sengaja tidak dipertahankan di
 * dua titik (kaki "SALDO AWAL :" ikut baris terakhir; baris lanjutan kolom 21
 * memutus keterangan).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bacaRekeningKoranBca, type RekeningKoran } from "./impor-bank-parser";
import { teksDariPdf } from "./pdf-teks";

const DIR = process.env.REKENING_KORAN_DIR;
const PARSE_RK = fileURLToPath(
  new URL(
    "../../../../docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan-assets/parse_rk.py",
    import.meta.url,
  ),
);

describe.skipIf(!DIR)("impor-bank-parser — e-statement asli (REKENING_KORAN_DIR)", () => {
  it(
    "setiap PDF lolos validasi kaki & identik dengan simulasi Python",
    async () => {
      const pdf = readdirSync(DIR!)
        .filter((f) => f.toLowerCase().endsWith(".pdf"))
        .sort();
      expect(pdf.length).toBeGreaterThan(0);

      const kerja = mkdtempSync(join(tmpdir(), "solamax-rk-"));
      try {
        const hasil = new Map<string, RekeningKoran>();
        for (const f of pdf) {
          const teks = await teksDariPdf(readFileSync(join(DIR!, f)));
          writeFileSync(join(kerja, f.replace(/\.pdf$/i, ".txt")), teks);
          hasil.set(f, bacaRekeningKoranBca(teks)); // melempar bila kaki tak cocok
        }

        const semua = [...hasil.values()];
        const baris = semua.flatMap((r) => r.rows);
        // Debit B2B Pertamina (pola H0000…) harus SELURUHNYA punya SO.
        const b2b = baris.filter((r) => r.amountSen < 0 && /H0000\d{13}/.test(r.keterangan));
        const ringkas = {
          berkas: hasil.size,
          baris: baris.length,
          debitB2b: b2b.length,
          denganSo: baris.filter((r) => r.so !== null).length,
          denganDokRef: baris.filter((r) => r.dokRef !== null).length,
        };
        console.log("[real] ringkasan", JSON.stringify(ringkas));
        expect(b2b.every((r) => r.so !== null)).toBe(true);
        const so = baris.flatMap((r) => (r.so ? [r.so] : []));
        expect(new Set(so).size).toBe(so.length);

        if (existsSync(PARSE_RK) && python3Ada()) {
          const keluaran = join(kerja, "py.json");
          execFileSync("python3", ["-I", PARSE_RK, kerja, keluaran], { stdio: "pipe" });
          type BarisPy = { acct: string; period: string; date: string; desc: string; amt: number; dir: "CR" | "DB" };
          const py = (JSON.parse(readFileSync(keluaran, "utf8")) as BarisPy[]).filter(
            (r) => !r.desc.startsWith("SALDO AWAL"),
          );
          for (const [f, rk] of hasil) {
            const [, acct = "", per = ""] = /_(\d+)_(\d{6})/.exec(f) ?? [];
            const harap = py
              .filter((r) => r.acct === acct && r.period === per)
              .map((r) => `${r.date} ${(r.dir === "DB" ? -1 : 1) * Math.round(r.amt * 100)}`);
            const dapat = rk.rows.map((r) => `${r.tanggal.slice(8, 10)}/${r.tanggal.slice(5, 7)} ${r.amountSen}`);
            expect(dapat, f).toEqual(harap);
            expect(rk.nomorRekening, f).toBe(acct.replace(/^0+/, ""));
            expect(rk.periode, f).toBe(`${per.slice(0, 4)}-${per.slice(4)}`);
          }
          console.log(`[real] identik dengan parse_rk.py: ${py.length} baris`);
        } else {
          console.log("[real] python3/parse_rk.py tidak ada — perbandingan Python dilewati");
        }
      } finally {
        rmSync(kerja, { recursive: true, force: true });
      }
    },
    120_000,
  );
});

function python3Ada(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
