/**
 * HARNESS VERIFIKASI ORACLE — Arus Minyak Harian, Imam Bonjol 1–6 Agustus 2026.
 *
 * Membaca angka dari **HTML hasil render komponen produksi**
 * (`<ArusMinyakSection>`, lewat `buildLaporanModel`), BUKAN dari fungsi query
 * yang membangunnya — supaya pembandingnya tidak membandingkan kode dengan
 * dirinya sendiri. Halaman `/unit/[code]/laporan/[date]` sendiri terkunci Google
 * OAuth (sesi DB) sehingga tak bisa dibuka agen, dan token sesi tidak boleh
 * disentuh; pola harness ini sama dengan `harian.render.test.tsx`.
 *
 * Ekspektasi di bawah ditranskripsi dari 6 PNG laporan EasyMax dan DISEGEL
 * sebelum query pertama dijalankan — lihat
 * `session-notes/2026-08-08-arus-minyak-harian.md` §1.
 *
 *   SCOPE_LIVE_DB=1 pnpm --filter @solamax/dashboard test -- arus-minyak.render
 *
 * Butuh cloud-sql-proxy + DATABASE_URL. Tanpa SCOPE_LIVE_DB=1 seluruh blok
 * di-skip (bukan lolos senyap: `describe.skip` terlihat di keluaran vitest).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { ArusMinyakSection } from "@/components/laporan/ArusMinyakSection";
import { buildLaporanModel } from "@/lib/laporan-model";
import { monthStart } from "@/lib/periods";

// Pool ditutup SEKALI di akhir berkas — afterAll per-describe pernah menutupnya
// sebelum describe kedua jalan ("Cannot use a pool after calling end").
afterAll(async () => {
  if (process.env.SCOPE_LIVE_DB !== "1") return;
  const { pool } = await import("@/lib/db");
  await pool.end();
});

const LIVE = process.env.SCOPE_LIVE_DB === "1";
const d = LIVE ? describe : describe.skip;

const UNIT_CODE = "6478111"; // Imam Bonjol
const OUT = process.env.ARUS_RENDER_OUT ?? "/tmp/arus-minyak-render.html";
/** CSS produksi ikut disematkan supaya berkas keluaran bisa DILIHAT MATA — bukan
 *  hanya di-assert strukturnya. Pelajaran proyek: grafik pernah lolos dua guard
 *  hijau dalam keadaan rusak secara visual. */
const CSS = [
  "styles/ds/tokens/colors.css",
  "styles/ds/tokens/typography.css",
  "styles/ds/tokens/spacing.css",
  "styles/ds/tokens/elevation.css",
  "styles/ds/tokens/motion.css",
  "styles/ds/tokens/layout.css",
  "styles/ds/base.css",
  "styles/app.css",
];

/** [Awal, Penerimaan, Penjualan, Teori, Fisik, Losses, %] — transkripsi PNG. */
type Cells = [number, number, number, number, number, number, number];
const ORACLE: Record<string, Record<string, Cells>> = {
  "2026-08-01": {
    PREMIUM: [0, 0, 0, 0, 0, 0, 0],
    PERTAMAX: [13981.84, 8000, 2650.35, 19331.49, 19145.08, -186.41, -7.03],
    SOLAR: [2122.45, 24000, 22280.63, 3841.82, 4080.56, 238.74, 1.07],
    "PERTAMAX TURBO": [5702.87, 0, 178.92, 5523.95, 5534.63, 10.68, 5.97],
    PERTALITE: [21598.26, 16000, 20070.91, 17527.35, 17692.4, 165.05, 0.82],
    DEXLITE: [15357.23, 0, 3731.45, 11625.78, 11675.79, 50.01, 1.34],
    "PERTAMINA DEX": [9628, 8000, 5167.57, 12460.43, 9740.66, -2719.77, -52.63],
    TOTAL: [68390.65, 56000, 54079.83, 70310.82, 67869.12, -2441.7, -4.51],
  },
  "2026-08-02": {
    PREMIUM: [0, 0, 0, 0, 0, 0, 0],
    PERTAMAX: [19145.08, 8000, 8852.38, 18292.7, 18253.2, -39.5, -0.45],
    SOLAR: [4080.56, 24000, 15896.76, 12183.8, 12315.45, 131.65, 0.83],
    "PERTAMAX TURBO": [5534.63, 0, 94.68, 5439.95, 5446.29, 6.34, 6.7],
    PERTALITE: [17692.4, 24000, 20383.49, 21308.91, 21411.04, 102.13, 0.5],
    DEXLITE: [11675.79, 8000, 3801.75, 15874.04, 15824.79, -49.25, -1.3],
    "PERTAMINA DEX": [9740.66, 8000, 3879.98, 13860.68, 13860.68, 0, 0],
    TOTAL: [67869.12, 72000, 52909.68, 86960.08, 87111.45, 151.37, 0.29],
  },
  "2026-08-03": {
    PREMIUM: [0, 0, 0, 0, 0, 0, 0],
    PERTAMAX: [18253.2, 8000, 9167.34, 17085.86, 16983.85, -102.01, -1.11],
    SOLAR: [12315.45, 24000, 34024.29, 2291.16, 2712.12, 420.96, 1.24],
    "PERTAMAX TURBO": [5446.29, 0, 60.99, 5385.3, 5388.62, 3.32, 5.44],
    PERTALITE: [21411.04, 16000, 21542.86, 15868.18, 16112.68, 244.5, 1.13],
    DEXLITE: [15824.79, 0, 3470.27, 12354.52, 12321.03, -33.49, -0.97],
    "PERTAMINA DEX": [13860.68, 0, 10745.24, 3115.44, 3115.44, 0, 0],
    TOTAL: [87111.45, 48000, 79010.99, 56100.46, 56633.74, 533.28, 0.67],
  },
  "2026-08-04": {
    PREMIUM: [0, 0, 0, 0, 0, 0, 0],
    PERTAMAX: [16983.85, 8000, 3191.14, 21792.71, 21713.07, -79.64, -2.5],
    SOLAR: [2712.12, 16000, 12167.89, 6544.23, 6750.38, 206.15, 1.69],
    "PERTAMAX TURBO": [5388.62, 0, 64.69, 5323.93, 5331.65, 7.72, 11.93],
    PERTALITE: [16112.68, 24000, 22857.04, 17255.64, 16806.8, -448.84, -1.96],
    DEXLITE: [12321.03, 8000, 4777.94, 15543.09, 15564.36, 21.27, 0.45],
    "PERTAMINA DEX": [3115.44, 8000, 2024.63, 9090.81, 9090.81, 0, 0],
    TOTAL: [56633.74, 64000, 45083.33, 75550.41, 75257.07, -293.34, -0.65],
  },
  "2026-08-05": {
    PREMIUM: [0, 0, 0, 0, 0, 0, 0],
    PERTAMAX: [21713.07, 0, 3109.72, 18603.35, 18685.01, 81.66, 2.63],
    SOLAR: [6750.38, 24000, 27142.81, 3607.57, 3930.38, 322.81, 1.19],
    "PERTAMAX TURBO": [5331.65, 0, 172.51, 5159.14, 5167.93, 8.79, 5.1],
    PERTALITE: [16806.8, 16000, 20223.03, 12583.77, 12834.83, 251.06, 1.24],
    DEXLITE: [15564.36, 0, 5108.36, 10456, 10498.83, 42.83, 0.84],
    "PERTAMINA DEX": [9090.81, 8000, 8777.81, 8313, 2766.43, -5546.57, -63.19],
    TOTAL: [75257.07, 48000, 64534.24, 58722.83, 53883.41, -4839.42, -7.5],
  },
  "2026-08-06": {
    PREMIUM: [0, 0, 0, 0, 0, 0, 0],
    PERTAMAX: [18685.01, 8000, 2859.71, 23825.3, 23635.74, -189.56, -6.63],
    SOLAR: [3930.38, 16000, 12433.15, 7497.23, 7550.5, 53.27, 0.43],
    "PERTAMAX TURBO": [5167.93, 0, 113.56, 5054.37, 5060.54, 6.17, 5.43],
    PERTALITE: [12834.83, 24000, 23422.46, 13412.37, 13219.91, -192.46, -0.82],
    DEXLITE: [10498.83, 8000, 6742.22, 11756.61, 11738.93, -17.68, -0.26],
    "PERTAMINA DEX": [2766.43, 8000, 3003.39, 7763.04, 13310, 5546.96, 184.69],
    TOTAL: [53883.41, 64000, 48574.49, 69308.92, 74515.62, 5206.7, 10.72],
  },
};

/**
 * SATU-SATUNYA penyimpangan yang diketahui & disengaja terhadap oracle: EasyMax
 * mencetak TOTAL Penjualan 2 Agu dari jual KOTOR (52.909,68) padahal kolom di
 * atasnya bersih-tera — TOTAL-nya tidak sama dengan jumlah kolomnya sendiri.
 * Di SolaMax TOTAL selalu jumlah kolom yang tercetak (52.909,04). Selisih 0,64 L
 * = tera resmi Dexlite hari itu. Dicatat sebagai pengecualian BERNAMA, bukan
 * toleransi umum — kalau muncul di sel lain, tes tetap merah.
 */
const DEVIASI_SAH: Record<string, { kolom: number; nilai: number; sebab: string }> = {
  "2026-08-02|TOTAL": {
    kolom: 2,
    nilai: 52909.04,
    sebab: "TOTAL EasyMax memakai jual KOTOR; SolaMax menjumlah kolom bersih-tera (Δ 0,64 L)",
  },
};

const COLS = ["Awal", "Penerimaan", "Penjualan", "Teori", "Fisik", "Losses", "%"];

/** "18.685,01" → 18685.01 ; "—" → null. */
function parseIdn(s: string): number | null {
  const t = s.replace(/&#x27;|&nbsp;/g, "").trim();
  if (t === "—" || t === "") return null;
  return Number(t.replace(/\./g, "").replace(",", ".").replace(/−/g, "-"));
}

/** Ekstrak sel dari HTML hasil render — via data-arus-row + isi <span>. */
export function parseArusHtml(html: string): Map<string, (number | null)[]> {
  const out = new Map<string, (number | null)[]>();
  const rowRe = /<div class="[^"]*cols-arus"[^>]*data-arus-row="([^"]*)"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|$)/g;
  for (const m of html.matchAll(rowRe)) {
    const nama = m[1]!;
    const cells = [...m[2]!.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((c) =>
      c[1]!.replace(/<[^>]+>/g, ""),
    );
    out.set(nama, cells.slice(1).map(parseIdn)); // sel[0] = nama produk
  }
  return out;
}

d("Arus Minyak vs oracle EasyMax — IB 1–6 Agustus 2026 (dari HTML terender)", () => {
  it(
    "336 sel: 7 baris produk + TOTAL × 7 kolom × 6 tanggal",
    async () => {
      const Q = await import("@/lib/queries");
      const { q } = await import("@/lib/db");
      type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];
      const [u] = await q<{ unit_id: number }>(
        `SELECT unit_id FROM public.unit WHERE code = $1`,
        [UNIT_CODE],
      );
      expect(u, `unit ${UNIT_CODE} tak ada`).toBeDefined();
      const unitId = u!.unit_id as SUID;

      const verdict: string[] = [];
      const htmlParts: string[] = [];
      let eksak = 0;
      let deviasi = 0;
      let absenNol = 0;
      const mismatch: string[] = [];

      for (const date of Object.keys(ORACLE)) {
        const glRows = await Q.getDailyGlByProduct(unitId, monthStart(date), date);
        // Jalur model PRODUKSI (filter d===date + urutan) — bukan jalan pintas.
        const model = buildLaporanModel(neutralRaw(glRows), {
          unitCode: UNIT_CODE,
          date,
          today: "2026-08-09",
          mi: { month: 8, year: 2026, dayOfMonth: 6, daysInMonth: 31 },
          detail: true,
        });
        const html = renderToStaticMarkup(<ArusMinyakSection arus={model.arusMinyak} />);
        htmlParts.push(`<h2 style="font:600 16px system-ui">${date}</h2>${html}`);
        const got = parseArusHtml(html);

        for (const [nama, want] of Object.entries(ORACLE[date]!)) {
          const row = got.get(nama);
          if (!row) {
            // Baris ada di oracle tapi tidak di SolaMax → hanya sah bila SELURUH
            // selnya nol (baris mati). Kalau tidak, itu angka yang HILANG.
            const allZero = want.every((x) => x === 0);
            if (allZero) {
              absenNol += 7;
              verdict.push(`${date} ${nama}: ABSEN≡NOL (7 sel) — baris mati, TOTAL tak berubah`);
            } else {
              for (const [i, w] of want.entries())
                mismatch.push(`${date} | ${nama} | ${COLS[i]} | oracle ${w} | ABSEN`);
            }
            continue;
          }
          for (const [i, w] of want.entries()) {
            const g = row[i];
            const dev = DEVIASI_SAH[`${date}|${nama}`];
            if (dev && dev.kolom === i) {
              expect(g, `${date} ${nama} ${COLS[i]} — deviasi bernama`).toBeCloseTo(dev.nilai, 2);
              deviasi++;
              verdict.push(`${date} ${nama} ${COLS[i]}: DEVIASI SAH ${g} vs oracle ${w} — ${dev.sebab}`);
              continue;
            }
            if (g != null && Math.abs(g - w) < 0.005) eksak++;
            else mismatch.push(`${date} | ${nama} | ${COLS[i]} | oracle ${w} | render ${g}`);
          }
        }
      }

      writeFileSync(
        OUT,
        `<meta charset="utf-8"><style>${CSS.map((f) => readFileSync(join(__dirname, "..", f), "utf8")).join("\n")}</style>` +
          `<body class="lap-page" style="padding:24px;background:var(--color-bg,#f5f6f8)">${htmlParts.join("")}</body>`,
      );
      console.log(
        `\nARUS MINYAK vs ORACLE — EKSAK ${eksak} · DEVIASI SAH ${deviasi} · ABSEN≡NOL ${absenNol} · MISMATCH ${mismatch.length} (total ${eksak + deviasi + absenNol + mismatch.length})\n` +
          verdict.map((v) => `  · ${v}`).join("\n"),
      );
      expect(mismatch, `MISMATCH:\n${mismatch.join("\n")}`).toEqual([]);
      expect(eksak + deviasi + absenNol).toBe(336);
    },
    240_000,
  );

  it("rantai carry-in DARI DATA: Stock Fisik hari-N = Stock Awal hari-N+1", async () => {
    const Q = await import("@/lib/queries");
    const { q } = await import("@/lib/db");
    type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];
    const [u] = await q<{ unit_id: number }>(`SELECT unit_id FROM public.unit WHERE code = $1`, [
      UNIT_CODE,
    ]);
    const rows = await Q.getDailyGlByProduct(u!.unit_id as SUID, "2026-08-01", "2026-08-06");
    const byDay = new Map<string, Map<string, (typeof rows)[number]>>();
    for (const r of rows) {
      if (!byDay.has(r.d)) byDay.set(r.d, new Map());
      byDay.get(r.d)!.set(r.ckdbbm, r);
    }
    const days = [...byDay.keys()].sort();
    expect(days).toHaveLength(6);
    let pasangan = 0;
    for (let i = 0; i < days.length - 1; i++) {
      for (const [code, r] of byDay.get(days[i]!)!) {
        const next = byDay.get(days[i + 1]!)!.get(code);
        expect(next, `${code} hilang di ${days[i + 1]}`).toBeDefined();
        expect(next!.fisik_prev, `${code} ${days[i]}→${days[i + 1]}`).toBeCloseTo(r.fisik!, 6);
        pasangan++;
      }
    }
    expect(pasangan).toBe(30); // 6 produk × 5 transisi
  }, 120_000);
});

/**
 * SANITY LINTAS-UNIT — section ini tampil untuk SEMUA unit, bukan hanya IB, dan
 * tidak ada oracle PNG untuk unit lain. Jadi yang dibuktikan di sini BUKAN
 * akurasi melainkan "tidak rusak": render jadi, identitas aritmetika berlaku
 * pada ANGKA YANG TERCETAK, dan tak ada nilai mustahil. Akurasi unit non-IB
 * TETAP BELUM TERVERIFIKASI.
 *
 * Dua kelas variansi berbeda: Adisucipto (DTGLJAM NULL-by-default, tanpa ATG)
 * dan 28 Oktober (kode POS 8 digit, tenant terpisah, ATG).
 */
d("Arus Minyak lintas-unit — tidak rusak (akurasi TIDAK diklaim)", () => {
  for (const code of ["6478101", "63781002"]) {
    it(`unit ${code}: identitas berlaku pada angka yang TERCETAK`, async () => {
      const Q = await import("@/lib/queries");
      const { q } = await import("@/lib/db");
      type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];
      const [u] = await q<{ unit_id: number }>(`SELECT unit_id FROM public.unit WHERE code = $1`, [
        code,
      ]);
      expect(u, `unit ${code} tak ada`).toBeDefined();
      const date = "2026-08-06";
      const glRows = await Q.getDailyGlByProduct(u!.unit_id as SUID, monthStart(date), date);
      const model = buildLaporanModel(neutralRaw(glRows), {
        unitCode: code,
        date,
        today: "2026-08-09",
        mi: { month: 8, year: 2026, dayOfMonth: 6, daysInMonth: 31 },
        detail: true,
      });
      const got = parseArusHtml(renderToStaticMarkup(<ArusMinyakSection arus={model.arusMinyak} />));
      // Kontrol: unit hidup HARUS punya baris. Nol baris = sinyal, bukan lulus.
      expect(got.size, `unit ${code} tanpa baris sama sekali`).toBeGreaterThan(1);

      const sum = [0, 0, 0, 0, 0, 0];
      for (const [nama, c] of got) {
        if (nama === "TOTAL") continue;
        // Sel dibaca dari HTML → boleh null ("—"); indeks di luar rentang mustahil
        // (8 kolom dijamin komponen) tapi TS tetap memaksa penjagaan eksplisit.
        expect(c, `${code} ${nama} jumlah kolom`).toHaveLength(7);
        const [awal, pen, jual, teori, fisik, loss, persen] = c as (number | null)[];
        if (awal != null && teori != null && pen != null && jual != null)
          expect(teori, `${code} ${nama} Teori`).toBeCloseTo(awal + pen - jual, 2);
        if (fisik != null && teori != null)
          expect(loss, `${code} ${nama} Losses`).toBeCloseTo(fisik - teori, 2);
        if (loss != null && jual != null && jual !== 0 && persen != null)
          expect(persen, `${code} ${nama} %`).toBeCloseTo((loss / jual) * 100, 1);
        // Nilai mustahil secara fisik: stok negatif atau di luar kapasitas tangki.
        for (const [i, v] of [awal, fisik].entries()) {
          if (v == null) continue;
          expect(v, `${code} ${nama} stok[${i}] mustahil`).toBeGreaterThanOrEqual(0);
          expect(v, `${code} ${nama} stok[${i}] mustahil`).toBeLessThan(200_000);
        }
        for (const [i, v] of c.slice(0, 6).entries()) sum[i]! += v ?? 0;
      }
      const tot = got.get("TOTAL")!;
      for (const [i, label] of ["Awal", "Penerimaan", "Penjualan", "Teori", "Fisik", "Losses"].entries())
        expect(tot[i], `${code} TOTAL ${label} ≠ jumlah kolom`).toBeCloseTo(sum[i]!, 1);
    }, 120_000);
  }
});

/**
 * Raw netral: hanya `glRows` & `date` yang menentukan `arusMinyak`. Field lain
 * diisi kosong agar harness tidak menyeret query terberat halaman (saldo
 * pelanggan ~100 dtk) hanya untuk memeriksa satu section.
 */
function neutralRaw(glRows: Awaited<ReturnType<typeof import("@/lib/queries").getDailyGlByProduct>>) {
  const empty = { rp: 0 };
  const TRIO = { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 };
  return {
    prodDay: [],
    glRows,
    prodMonth: [],
    delivMonth: [],
    doDay: [],
    doAnomalies: [],
    doSuspects: [],
    shift: { shifts: 0, last_dtgljam: null } as never,
    corrections: 0,
    cash: [],
    saldo: { awal: TRIO, akhir: TRIO } as never,
    recapPelanggan: [empty],
    recapEdc: [empty],
    recapDeposit: [empty],
    recapPendapatanLain: [],
    recapPengeluaran: [],
    recapSetoran: [],
    terra: [empty],
    tetanggaSebelum: { f: [], g: [], i: [] },
    tetanggaSesudah: { f: [], g: [], i: [] },
  } as never;
}
