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
import { buildArusMinyak } from "@/lib/arus-minyak";
import { buildLaporanModel } from "@/lib/laporan-model";
import { gradeArus, OVERFLOW, parseArusHtml, ringkas, type DeviasiSah } from "@/lib/arus-minyak.grade";
import { addDays as addHari, monthStart } from "@/lib/periods";

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
const OUT_LINTAS = process.env.ARUS_RENDER_OUT_LINTAS ?? "/tmp/arus-minyak-lintas.html";
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
  "2025-11-21": {
    PREMIUM: [0, 0, 0, 0, 0, 0, 0],
    PERTAMAX: [21857.98, 0, 2228.96, 19629.02, 19658.07, 29.05, 1.3],
    SOLAR: [17126.28, 16000, 29151.78, 3974.5, 4529.13, 554.63, 1.9],
    "PERTAMAX TURBO": [5184.48, 0, 260.8, 4923.68, 4944.65, 20.97, 8.04],
    PERTALITE: [25756.15, 16000, 19942.27, 21813.88, 22080.17, 266.29, 1.34],
    DEXLITE: [12901.22, 8000, 10142.88, 10758.34, 10920.69, 162.35, 1.46],
    "PERTAMINA DEX": [6348.55, 8000, 7176.37, 7172.18, 6952.36, -219.82, -3.06],
    TOTAL: [89174.66, 48000, 69903.06, 68271.6, 69085.07, 813.47, 1.16],
  },
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
 * D-5 **PENSIUN** (putaran 3). Dulu TOTAL Penjualan 2 Agu dicatat sebagai deviasi
 * bernama karena SolaMax menjumlah kolom bersih-tera sementara EasyMax memakai
 * jual KOTOR. Oracle 21 Nov 2025 membuktikan itu BUKAN inkonsistensi EasyMax
 * melainkan definisinya: TOTAL Penjualan & penyebut % memang kotor. Setelah
 * dicerminkan, tak ada lagi sel yang menyimpang — daftar ini KOSONG, dan
 * mekanismenya tetap diuji di `arus-minyak.test.ts`.
 */
const DEVIASI_SAH: Record<string, DeviasiSah> = {};

const COLS = ["Awal", "Penerimaan", "Penjualan", "Teori", "Fisik", "Losses", "%"];


/**
 * Render satu (unit, tanggal) lewat jalur PRODUKSI dan kembalikan sel-nya dari
 * HTML. Satu-satunya tempat harness menyentuh unit — dipakai IB maupun armada,
 * sehingga menambah unit TIDAK menambah jalur kode yang bisa menyimpang.
 */
async function selTerender(
  code: string,
  date: string,
): Promise<{ sel: Map<string, (number | null)[]>; html: string }> {
  const Q = await import("@/lib/queries");
  const { q } = await import("@/lib/db");
  type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];
  const [u] = await q<{ unit_id: number }>(`SELECT unit_id FROM public.unit WHERE code = $1`, [
    code,
  ]);
  if (!u) throw new Error(`unit ${code} tak ada`);
  const id = u.unit_id as SUID;
  const [glRows, zc] = await Promise.all([
    Q.getDailyGlByProduct(id, monthStart(date), date),
    Q.getZeroClosingEvents([id], addHari(date, -1), addHari(date, 1)),
  ]);
  const model = buildLaporanModel(neutralRaw(glRows, zc), {
    unitCode: code,
    date,
    today: "2026-08-10",
    mi: { month: 8, year: 2026, dayOfMonth: 6, daysInMonth: 31 },
    detail: true,
  });
  const html = renderToStaticMarkup(<ArusMinyakSection arus={model.arusMinyak} />);
  return { sel: parseArusHtml(html), html };
}

/** Uji satu unit terhadap oracle-nya. Dipakai IB dan setiap unit armada. */
async function ujiOracle(
  code: string,
  nama: string,
  oracle: Record<string, Record<string, Cells>>,
  outHtml?: string,
) {
  const render: Record<string, Map<string, (number | null)[]>> = {};
  const htmlParts: string[] = [];
  for (const date of Object.keys(oracle)) {
    const { sel, html } = await selTerender(code, date);
    render[date] = sel;
    htmlParts.push(`<h2 style="font:600 16px system-ui">${nama} ${date}</h2>${html}`);
  }
  const hasil = gradeArus(oracle, render, COLS, DEVIASI_SAH);
  const r = ringkas(hasil);
  const mismatch = hasil
    .filter((h) => h.vonis === "mismatch")
    .map((h) => `${code} ${h.tanggal} | ${h.baris} | ${h.kolom} | oracle ${h.oracle} | render ${h.render ?? "ABSEN"}`);
  if (outHtml)
    writeFileSync(
      outHtml,
      `<meta charset="utf-8"><style>${CSS.map((f) => readFileSync(join(__dirname, "..", f), "utf8")).join("\n")}</style>` +
        `<body class="lap-page" style="padding:24px;background:var(--color-bg,#f5f6f8)">${htmlParts.join("")}</body>`,
    );
  console.log(
    `  ${nama.padEnd(20)} EKSAK ${String(r.eksak).padStart(4)} · DEVIASI ${r.deviasi_sah} · ` +
      `ABSEN≡NOL ${String(r.absen_nol).padStart(3)} · MISMATCH ${String(r.mismatch).padStart(3)} (total ${r.total})`,
  );
  return { hasil, r, mismatch };
}

d("Arus Minyak vs oracle EasyMax — IB 1–6 Agustus 2026 (dari HTML terender)", () => {
  it(
    "392 sel: 8 baris × 7 kolom × 7 tanggal (6 Agu 2026 + 21 Nov 2025)",
    async () => {
      const { hasil, r, mismatch } = await ujiOracle(UNIT_CODE, "Imam Bonjol", ORACLE, OUT);
      // Dilaporkan TERPISAH: jendela Agustus lama (336) supaya bisa dibandingkan
      // dengan angka putaran sebelumnya, dan 21 Nov 2025 yang baru (56).
      const sub = (pred: (t: string) => boolean) => ringkas(hasil.filter((h) => pred(h.tanggal)));
      const agu = sub((t) => t.startsWith("2026-08"));
      const nov = sub((t) => t.startsWith("2025-11"));
      console.log(
        `\n  jendela Agustus 2026 (6 tgl): EKSAK ${agu.eksak} · DEVIASI ${agu.deviasi_sah} · ABSEN≡NOL ${agu.absen_nol} · MISMATCH ${agu.mismatch} (total ${agu.total})` +
          `\n  21 Nov 2025 (1 tgl, tera 1.000 L): EKSAK ${nov.eksak} · DEVIASI ${nov.deviasi_sah} · ABSEN≡NOL ${nov.absen_nol} · MISMATCH ${nov.mismatch} (total ${nov.total})`,
      );
      expect(mismatch, `MISMATCH:\n${mismatch.join("\n")}`).toEqual([]);
      expect(r.total).toBe(392);
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
  const LINTAS: Array<[string, string, string]> = [
    ["6478101", "2026-08-06", "Adisucipto — kelas DTGLJAM NULL-by-default, tanpa ATG"],
    ["63781002", "2026-08-06", "28 Oktober — kode POS 8 digit, tenant terpisah"],
    // Hari BERJALAN: satu-satunya keadaan `provisional` yang benar-benar ada di
    // data 2026 (opname penutup belum masuk) → penanda "belum final" terlihat.
    ["6478101", "2026-08-09", "Adisucipto — hari berjalan (provisional)"],
    ["63781002", "2026-08-09", "28 Oktober — hari berjalan (provisional)"],
    // KELAS 2 — penutup-nol pada SEBAGIAN tangki di hari yang SUDAH SELESAI:
    // provisional=FALSE, angkanya kurang ±10.000 L tapi tampil final. Inilah
    // kasus berbahaya yang wajib tertangkap badge.
    ["63781002", "2026-07-22", "28 Oktober — penutup-nol KELAS 2 (T-05, provisional FALSE)"],
  ];
  const potongan: string[] = [];
  const penutupNol: string[] = [];

  afterAll(() => {
    if (penutupNol.length)
      console.log(
        `\nPENUTUP-NOL terdeteksi (${penutupNol.length}) — angka Losses-nya artefak data, bukan kerugian:\n` +
          penutupNol.map((x) => `  · ${x}`).join("\n"),
      );
    if (potongan.length)
      writeFileSync(
        OUT_LINTAS,
        `<meta charset="utf-8"><style>${CSS.map((f) => readFileSync(join(__dirname, "..", f), "utf8")).join("\n")}</style>` +
          `<body class="lap-page" style="padding:24px;background:var(--color-bg,#f5f6f8)">${potongan.join("")}</body>`,
      );
  });


  it("BADGE MENYALA di kelas 2 (28 Okt 22 Jul) — sebagian tangki nol, provisional FALSE", async () => {
    const m = await modelUntuk("63781002", "2026-07-22");
    expect(m.arusMinyak.provisional, "prasyarat: kasus ini justru TIDAK provisional").toBe(false);
    const kena = m.arusMinyak.rows.filter((r) => r.zeroClosing !== null);
    expect(kena.length, "badge padam pada kasus kelas 2").toBeGreaterThan(0);
    expect(kena.every((r) => r.zeroClosing!.kelas === 2)).toBe(true);
    expect(kena[0]!.zeroClosing!.tangki).toContain("T-05");
    // Angkanya TIDAK boleh berubah: badge menandai, bukan menambal.
    expect(m.arusMinyak.rows.every((r) => r.losses === null || Number.isFinite(r.losses))).toBe(true);
  }, 120_000);

  it("BADGE PADAM di KETUJUH hari oracle bersih — penanda yang selalu menyala tak berinformasi", async () => {
    for (const date of Object.keys(ORACLE)) {
      const m = await modelUntuk(UNIT_CODE, date);
      expect(m.arusMinyak.zeroClosingCount, `badge menyala padahal ${date} bersih`).toBe(0);
      expect(m.arusMinyak.rows.every((r) => r.zeroClosing === null)).toBe(true);
    }
  }, 300_000);

  for (const [code, tanggal, label] of LINTAS) {
    it(`unit ${code} ${tanggal}: identitas berlaku pada angka yang TERCETAK`, async () => {
      const Q = await import("@/lib/queries");
      const { q } = await import("@/lib/db");
      type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];
      const [u] = await q<{ unit_id: number }>(`SELECT unit_id FROM public.unit WHERE code = $1`, [
        code,
      ]);
      expect(u, `unit ${code} tak ada`).toBeDefined();
      const date = tanggal;
      const glRows = await Q.getDailyGlByProduct(u!.unit_id as SUID, monthStart(date), date);
      const zc = await Q.getZeroClosingEvents(
        [u!.unit_id as SUID],
        addHari(date, -1),
        addHari(date, 1),
      );
      const model = buildLaporanModel(neutralRaw(glRows, zc), {
        unitCode: code,
        date,
        today: "2026-08-09",
        mi: { month: 8, year: 2026, dayOfMonth: 6, daysInMonth: 31 },
        detail: true,
      });
      const markup = renderToStaticMarkup(<ArusMinyakSection arus={model.arusMinyak} />);
      potongan.push(`<h2 style="font:600 16px system-ui">${label} · ${tanggal}</h2>${markup}`);
      const got = parseArusHtml(markup);
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
        // PENUTUP-NOL — kelas yang lolos dari ">= 0" karena 0 memang >= 0.
        // Opname penutup tercatat 0 padahal stok awal ribuan liter → Losses
        // sebesar seluruh isi tangki, dan itu BUKAN kerugian. Fenomena ini
        // sudah punya detektor tersendiri (`getZeroClosingEvents`, terpasang di
        // /laporan-harian & feed anomali) tetapi BELUM tersambung ke halaman
        // Laporan. Yang dijaga di sini: jangan sampai ia tampil sebagai angka
        // FINAL tanpa penanda apa pun.
        if (awal != null && awal > 1000 && fisik === 0) {
          penutupNol.push(`${code} ${tanggal} ${nama}: awal ${awal} → fisik 0`);
          expect(
            model.arusMinyak.provisional,
            `${code} ${tanggal} ${nama}: penutup-nol tampil sebagai FINAL tanpa penanda`,
          ).toBe(true);
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
 * SAPUAN KONSISTENSI INTERNAL — jendela panjang, TANPA oracle.
 *
 * Yang dibuktikan di sini KERUSAKAN STRUKTURAL, bukan akurasi: identitas
 * antar-kolom, rantai carry-in, dan ledakan nilai. Nol pelanggaran atas ratusan
 * hari **BUKAN** bukti akurasi — putaran 3 baru saja menunjukkan persis kenapa:
 * rumus % yang SALAH lolos 336 sel selama dua putaran karena jendelanya tak mampu
 * membedakan. Sapuan ini buta terhadap kesalahan yang KONSISTEN.
 */

/**
 * ORACLE ARMADA — RESUME EasyMax unit non-IB (ekspor owner, putaran 4).
 * Ditranskripsi dari PNG di `~/Desktop/ArusMinyak/<UNIT>/`. Prediksi SolaMax
 * untuk tanggal-tanggal ini sudah DISEGEL di decision log §P4-3 sebelum satu pun
 * berkas dibuka.
 */
const ORACLE_ARMADA: Record<string, { nama: string; hari: Record<string, Record<string, Cells>> }> = {
  "6478311": {
    nama: "Korek",
    hari: {
      "2026-04-30": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [15785.36, 4000, 1035.49, 18749.87, 18511.12, -238.75, -20.31],
        SOLAR: [14176.37, 0, 3517.44, 10658.93, 10658.93, 0, 0],
        "PERTAMAX TURBO": [7258.82, 0, 1.6, 7257.22, 7192.22, -65, -18.45],
        PERTALITE: [16932.42, 24000, 20784.31, 20148.11, 20424.85, 276.74, 1.33],
        DEXLITE: [7709.21, 0, 1372.25, 6336.96, 6336.96, 0, 0],
        "PERTAMINA DEX": [6423.72, 0, 1108.2, 5315.52, 5238.96, -76.56, -5.99],
        TOTAL: [68285.9, 28000, 28479.92, 68466.61, 68363.04, -103.57, -0.36],
      },
      "2026-08-01": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [18767.88, 0, 507.73, 18260.15, 18189.08, -71.07, -14],
        // % Solar = ***,** di oracle (−371,26/50,00 = −742,52 → 7 karakter).
        SOLAR: [9761.77, 16000, 50, 25711.77, 25340.51, -371.26, OVERFLOW],
        "PERTAMAX TURBO": [5229.67, 0, 199.69, 5029.98, 5032.09, 2.11, 1.06],
        PERTALITE: [18689.5, 24000, 22995.17, 19694.33, 19852.37, 158.04, 0.69],
        DEXLITE: [1961.64, 0, 1641.18, 320.46, 320.46, 0, 0],
        "PERTAMINA DEX": [7229.14, 0, 1230.48, 5998.66, 5960.03, -38.63, -3.14],
        TOTAL: [61639.6, 40000, 26624.25, 75015.35, 74694.54, -320.81, -1.2],
      },
      "2026-08-02": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [18189.08, 0, 836.24, 17352.84, 17431.53, 78.69, 9.41],
        SOLAR: [25340.51, 0, 1994.85, 23345.66, 23425.93, 80.27, 4.02],
        "PERTAMAX TURBO": [5032.09, 0, 68.98, 4963.11, 4964.41, 1.3, 1.88],
        PERTALITE: [19852.37, 24000, 27725.31, 16127.06, 16451.06, 324, 1.17],
        DEXLITE: [320.46, 4000, 1577.31, 2743.15, 2743.15, 0, 0],
        "PERTAMINA DEX": [5960.03, 0, 1478.85, 4481.18, 4467, -14.18, -0.96],
        TOTAL: [74694.54, 28000, 33681.54, 69013, 69483.08, 470.08, 1.4],
      },
      "2026-08-03": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [17431.53, 0, 622.94, 16808.59, 16813.8, 5.21, 0.84],
        SOLAR: [23425.93, 8000, 13639.7, 17786.23, 18146.62, 360.39, 2.64],
        "PERTAMAX TURBO": [4964.41, 0, 61.43, 4902.98, 4901.91, -1.07, -1.74],
        PERTALITE: [16451.06, 24000, 27026.74, 13424.32, 13718.59, 294.27, 1.09],
        DEXLITE: [2743.15, 4000, 2973.64, 3769.51, 3853.51, 84, 2.82],
        "PERTAMINA DEX": [4467, 4000, 1777.17, 6689.83, 6666.76, -23.07, -1.3],
        TOTAL: [69483.08, 40000, 46101.62, 63381.46, 64101.19, 719.73, 1.56],
      },
      "2026-08-04": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [16813.8, 0, 684.92, 16128.88, 16132.37, 3.49, 0.51],
        SOLAR: [18146.62, 16000, 13352.34, 20794.28, 20793.87, -0.41, 0],
        "PERTAMAX TURBO": [4901.91, 0, 35.05, 4866.86, 4867.8, 0.94, 2.68],
        PERTALITE: [13718.59, 32000, 22730.47, 22988.12, 23092.26, 104.14, 0.46],
        DEXLITE: [3853.51, 0, 2207.23, 1646.28, 1712.97, 66.69, 3.02],
        "PERTAMINA DEX": [6666.76, 0, 1338.28, 5328.48, 5271.39, -57.09, -4.27],
        TOTAL: [64101.19, 48000, 40348.29, 71752.9, 71870.66, 117.76, 0.29],
      },
      "2026-08-05": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [16132.37, 0, 367.62, 15764.75, 15766.98, 2.23, 0.61],
        SOLAR: [20793.87, 8000, 18223.45, 10570.42, 11000.51, 430.09, 2.36],
        "PERTAMAX TURBO": [4867.8, 0, 102.11, 4765.69, 4769.21, 3.52, 3.45],
        PERTALITE: [23092.26, 24000, 26202.7, 20889.56, 21249.21, 359.65, 1.37],
        DEXLITE: [1712.97, 4000, 3644.81, 2068.16, 2639.16, 571, 15.67],
        "PERTAMINA DEX": [5271.39, 0, 1176.08, 4095.31, 4107.74, 12.43, 1.06],
        TOTAL: [71870.66, 36000, 49716.77, 58153.89, 59532.81, 1378.92, 2.77],
      },
      "2026-08-06": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [15766.98, 0, 642.63, 15124.35, 15133.67, 9.32, 1.45],
        SOLAR: [11000.51, 8000, 11964.08, 7036.43, 7310.5, 274.07, 2.29],
        "PERTAMAX TURBO": [4769.21, 0, 73.14, 4696.07, 4697.64, 1.57, 2.15],
        PERTALITE: [21249.21, 40000, 23949.11, 37300.1, 37010.13, -289.97, -1.21],
        DEXLITE: [2639.16, 4000, 2576.28, 4062.88, 4267.88, 205, 7.96],
        "PERTAMINA DEX": [4107.74, 4000, 1511.66, 6596.08, 6634.24, 38.16, 2.52],
        TOTAL: [59532.81, 56000, 40716.9, 74815.91, 75054.06, 238.15, 0.58],
      },
      "2026-08-07": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [15133.67, 0, 783.79, 14349.88, 14306.37, -43.51, -5.55],
        SOLAR: [7310.5, 8000, 5362.4, 9948.1, 9996.61, 48.51, 0.9],
        "PERTAMAX TURBO": [4697.64, 0, 91.79, 4605.85, 4606.97, 1.12, 1.22],
        PERTALITE: [37010.13, 16000, 25409.68, 27600.45, 28375.44, 774.99, 3.05],
        DEXLITE: [4267.88, 4000, 3376.02, 4891.86, 6005.86, 1114, 33],
        "PERTAMINA DEX": [6634.24, 0, 1034.23, 5600.01, 5554.34, -45.67, -4.42],
        TOTAL: [75054.06, 28000, 36057.91, 66996.15, 68845.59, 1849.44, 5.13],
      },
      "2026-08-08": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [14306.37, 0, 879.61, 13426.76, 13428.64, 1.88, 0.21],
        SOLAR: [9996.61, 16000, 11746.95, 14249.66, 14358.22, 108.56, 0.92],
        "PERTAMAX TURBO": [4606.97, 0, 51.26, 4555.71, 4545.63, -10.08, -19.66],
        PERTALITE: [28375.44, 32000, 26657.19, 33718.25, 33641.04, -77.21, -0.29],
        DEXLITE: [6005.86, 0, 2379.14, 3626.72, 3626.72, 0, 0],
        "PERTAMINA DEX": [5554.34, 0, 1085.57, 4468.77, 4471.53, 2.76, 0.25],
        TOTAL: [68845.59, 48000, 42799.72, 74045.87, 74071.78, 25.91, 0.06],
      },
    },
  },
  "6378301": {
    nama: "Bakau",
    hari: {
      // tera 789,10 L. ⚠ sel TOTAL Penjualan PRA-TERUNGKAP (§P5-1) — bukan
      // konfirmasi segel; sel % di bawahnya TIDAK pra-terungkap dan itulah yang
      // membuktikan penyebut KOTOR di unit ini.
      "2026-03-04": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [17993.88, 0, 2252.36, 15741.52, 15767.43, 25.91, 1.11],
        SOLAR: [28507.38, 0, 5029.39, 23477.99, 23440.4, -37.59, -0.71],
        "PERTAMAX TURBO": [12977.87, 0, 152.25, 12825.62, 12825.06, -0.56, -0.29],
        PERTALITE: [13530.39, 16000, 11481.41, 18048.98, 17791.19, -257.79, -2.2],
        DEXLITE: [2892.99, 0, 2163.68, 729.31, 730.41, 1.1, 0.05],
        "PERTAMINA DEX": [8145.26, 0, 241.87, 7903.39, 7903.39, 0, 0],
        TOTAL: [84047.77, 16000, 22110.06, 78726.81, 78457.88, -268.93, -1.22],
      },
    },
  },
  "6478201": {
    nama: "Batu Layang",
    hari: {
      // tera 421,31 L. ⚠ TOTAL Penjualan PRA-TERUNGKAP; EMPAT sel % per-baris
      // (Pertalite −1,79 · Dexlite −2,23 · P.Dex −2,10 · TOTAL −0,54) TIDAK
      // pra-terungkap dan semuanya menuntut penyebut KOTOR.
      "2026-02-13": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [12357.31, 0, 1257.63, 11099.68, 11252.64, 152.96, 12.16],
        SOLAR: [4474.45, 16000, 12636.62, 7837.83, 7926.32, 88.49, 0.7],
        "PERTAMAX TURBO": [8492.84, 0, 283.75, 8209.09, 8213.53, 4.44, 1.56],
        PERTALITE: [37770.44, 24000, 19838.64, 41931.8, 41572.54, -359.26, -1.79],
        DEXLITE: [8321.6, 8000, 2949.47, 13372.13, 13305.55, -66.58, -2.23],
        "PERTAMINA DEX": [6425.33, 5000, 1412.7, 10012.63, 9982.09, -30.54, -2.1],
        TOTAL: [77841.97, 53000, 38800.12, 92463.16, 92252.67, -210.49, -0.54],
      },
    },
  },
  "6478101": {
    nama: "Adisucipto",
    hari: {
      // Pembacaan BULAT (kelas DTGLJAM NULL-by-default) & tanpa tangki Turbo.
      "2026-08-01": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [10089, 0, 206, 9883, 9857, -26, -12.62],
        SOLAR: [8055, 8000, 8367, 7688, 7703, 15, 0.18],
        "PERTAMAX TURBO": [0, 0, 0, 0, 0, 0, 0],
        PERTALITE: [18831, 8000, 8183, 18648, 18585, -63, -0.77],
        DEXLITE: [15724, 0, 2644, 13080, 14082, 1002, 37.9],
        "PERTAMINA DEX": [6688, 0, 134, 6554, 6554, 0, 0],
        TOTAL: [59387, 16000, 19534, 55853, 56781, 928, 4.75],
      },
    },
  },
  "63781002": {
    nama: "28 Oktober",
    hari: {
      "2026-08-01": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [28298.49, 0, 1544.04, 26754.45, 26765.29, 10.84, 0.7],
        SOLAR: [7764.38, 16000, 21242.88, 2521.5, 2687.86, 166.36, 0.78],
        "PERTAMAX TURBO": [7878.49, 0, 199.91, 7678.58, 7685.33, 6.75, 3.38],
        PERTALITE: [23140.28, 24000, 20908.53, 26231.75, 26585.82, 354.07, 1.69],
        DEXLITE: [26565.83, 0, 2338.7, 24227.13, 24238.83, 11.7, 0.5],
        "PERTAMINA DEX": [9036.26, 0, 5269.52, 3766.74, 3896.46, 129.72, 2.46],
        TOTAL: [102683.73, 40000, 51503.58, 91180.15, 91859.59, 679.44, 1.32],
      },
      "2026-08-02": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [26765.29, 0, 1459.27, 25306.02, 25325.04, 19.02, 1.3],
        SOLAR: [2687.86, 24000, 8421.4, 18266.46, 18316.88, 50.42, 0.6],
        "PERTAMAX TURBO": [7685.33, 0, 102.58, 7582.75, 7587.89, 5.14, 5.01],
        PERTALITE: [26585.82, 24000, 20107.22, 30478.6, 30565.73, 87.13, 0.43],
        DEXLITE: [24238.83, 0, 2790.68, 21448.15, 21556.13, 107.98, 3.87],
        "PERTAMINA DEX": [3896.46, 8000, 2308.23, 9588.23, 9552.03, -36.2, -1.57],
        TOTAL: [91859.59, 56000, 35189.38, 112670.21, 112903.7, 233.49, 0.66],
      },
    },
  },
  "6478106": {
    nama: "Bundaran Kotabaru",
    hari: {
      // 05 Agu = KONTROL: hari SEBELUM hari-divergen, diprediksi EKSAK.
      "2026-08-05": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [16619, 0, 4021.1, 12597.9, 12651.13, 53.23, 1.32],
        SOLAR: [14135.37, 8000, 8725.21, 13410.16, 13448.7, 38.54, 0.44],
        "PERTAMAX TURBO": [6876.12, 0, 188.57, 6687.55, 6755.34, 67.79, 35.95],
        PERTALITE: [45068.3, 24000, 28620.61, 40447.69, 40605.81, 158.12, 0.55],
        DEXLITE: [4169.98, 0, 2285.59, 1884.39, 1882.21, -2.18, -0.1],
        "PERTAMINA DEX": [4141.09, 3664, 1043.7, 6761.39, 6599.04, -162.35, -15.56],
        TOTAL: [91009.86, 35664, 44888.78, 81789.08, 81942.23, 153.15, 0.34],
      },
      "2026-08-08": {
        PREMIUM: [0, 0, 0, 0, 0, 0, 0],
        PERTAMAX: [13083.6, 0, 3534.04, 9549.56, 9587.86, 38.3, 1.08],
        SOLAR: [11555.15, 8000, 9207.67, 10347.48, 10419.47, 71.99, 0.78],
        "PERTAMAX TURBO": [6423.42, 0, 230.81, 6192.61, 6122.49, -70.12, -30.38],
        PERTALITE: [45018.3, 24000, 30119.14, 38899.16, 38863.03, -36.13, -0.12],
        DEXLITE: [4934.5, 0, 2748.22, 2186.28, 2163.27, -23.01, -0.84],
        "PERTAMINA DEX": [4848.28, 0, 571.79, 4276.49, 4320.19, 43.7, 7.64],
        TOTAL: [85863.25, 32000, 46411.67, 71451.58, 71476.31, 24.73, 0.05],
      },
    },
  },
};

d("Arus Minyak vs oracle EasyMax — ARMADA (unit non-IB)", () => {
  const gagal: string[] = [];
  for (const [code, { nama, hari }] of Object.entries(ORACLE_ARMADA)) {
    it(`${nama} (${code}) — ${Object.keys(hari).length} tanggal`, async () => {
      const { mismatch } = await ujiOracle(code, nama, hari, `/tmp/arus-${code}.html`);
      gagal.push(...mismatch);
      expect(mismatch, `MISMATCH:\n${mismatch.join("\n")}`).toEqual([]);
    }, 240_000);
  }
});


/**
 * KARAKTERISASI CACAT HULU — Bundaran Kotabaru 2026-08-07.
 *
 * Tes ini SENGAJA menegaskan bahwa SolaMax MELESET dari oracle, karena cacatnya
 * ada di `getDailyGlByProduct` (aturan pemilihan opname penutup) yang di luar
 * lingkup PR ini. Lihat decision log §P4-4.
 *
 * ⚠️ Kalau tes ini GAGAL setelah perbaikan hulu mendarat, itu BUKAN regresi —
 * itu tandanya cacatnya sudah hilang. HAPUS tes ini dan pindahkan tanggalnya ke
 * ORACLE_ARMADA. Ia ada supaya cacatnya mustahil terlupakan, bukan supaya
 * suite-nya hijau.
 */
d("KARAKTERISASI cacat hulu (cacat A) — KB 06 & 07 Agu", () => {
  const KB: Record<string, Record<string, Cells>> = {
    // Hari DIVERGEN itu sendiri → Fisik meleset (Awal masih benar).
    "2026-08-06": {
      PREMIUM: [0, 0, 0, 0, 0, 0, 0],
      PERTAMAX: [12651.13, 0, 3699.2, 8951.93, 8957.49, 5.56, 0.15],
      SOLAR: [13448.7, 8000, 9981.75, 11466.95, 11546.14, 79.19, 0.79],
      "PERTAMAX TURBO": [6755.34, 0, 172.12, 6583.22, 6633.66, 50.44, 29.31],
      PERTALITE: [40605.81, 32000, 28763.83, 43841.98, 43570.18, -271.8, -0.94],
      DEXLITE: [1882.21, 8000, 2610.7, 7271.51, 7339.25, 67.74, 2.59],
      "PERTAMINA DEX": [6599.04, 0, 1106.98, 5492.06, 5503.46, 11.4, 1.03],
      TOTAL: [81942.23, 48000, 46334.58, 83607.65, 83550.18, -57.47, -0.12],
    },
    // Hari SESUDAHNYA → Awal meleset (Fisik sudah benar lagi).
    "2026-08-07": {
      PREMIUM: [0, 0, 0, 0, 0, 0, 0],
      PERTAMAX: [8957.49, 8000, 3861.2, 13096.29, 13083.6, -12.69, -0.33],
      SOLAR: [11546.14, 8000, 7824.59, 11721.55, 11555.15, -166.4, -2.13],
      "PERTAMAX TURBO": [6633.66, 0, 243.65, 6390.01, 6423.42, 33.41, 13.71],
      PERTALITE: [43570.18, 32000, 30764.49, 44805.69, 45018.3, 212.61, 0.69],
      DEXLITE: [7339.25, 0, 2389.35, 4949.9, 4934.5, -15.4, -0.64],
      "PERTAMINA DEX": [5503.46, 0, 659.97, 4843.49, 4848.28, 4.79, 0.73],
      TOTAL: [83550.18, 48000, 45743.25, 85806.93, 85863.25, 56.32, 0.12],
    },
  };
  /**
   * ⚠️ Tes ini SENGAJA menegaskan SolaMax MELESET — cacatnya di
   * `getDailyGlByProduct` (sesi hulu terpisah). Kalau ia GAGAL setelah perbaikan
   * hulu mendarat, itu BUKAN regresi: HAPUS tes ini dan pindahkan kedua tanggal
   * ke ORACLE_ARMADA. Ia ada supaya cacatnya mustahil terlupakan.
   *
   * Bentuk kegagalannya diprediksi DI MUKA (decision log §P5-2) dan berlawanan
   * arah di kedua hari — itulah yang membuatnya uji, bukan sekadar catatan.
   */
  const kasus: Array<[string, string[], string[]]> = [
    ["2026-08-06", ["Fisik", "Losses", "%"], ["Awal", "Penerimaan", "Penjualan", "Teori"]],
    ["2026-08-07", ["Awal", "Teori", "Losses", "%"], ["Penerimaan", "Penjualan", "Fisik"]],
  ];
  for (const [tgl, kolomMeleset, kolomEksak] of kasus)
    it(`${tgl}: meleset TEPAT di ${kolomMeleset.join("/")}, eksak di ${kolomEksak.join("/")}`, async () => {
      const { sel } = await selTerender("6478106", tgl);
      const hasil = gradeArus({ [tgl]: KB[tgl]! }, { [tgl]: sel }, COLS);
      const salah = hasil.filter((h) => h.vonis === "mismatch");
      expect(new Set(salah.map((h) => h.kolom))).toEqual(new Set(kolomMeleset));
      for (const k of kolomEksak)
        expect(salah.filter((h) => h.kolom === k), `${k} ikut meleset`).toEqual([]);
      // DEXLITE = satu-satunya produk tanpa entri telat → harus tetap cocok.
      expect(salah.some((h) => h.baris === "DEXLITE"), "DEXLITE ikut meleset").toBe(false);
    }, 120_000);
});

d("Sapuan konsistensi internal IB — 120 hari, tanpa oracle", () => {
  it("identitas, rantai carry-in, dan ledakan nilai", async () => {
    const Q = await import("@/lib/queries");
    const { q } = await import("@/lib/db");
    type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];
    const [u] = await q<{ unit_id: number }>(`SELECT unit_id FROM public.unit WHERE code = $1`, [
      UNIT_CODE,
    ]);
    const id = u!.unit_id as SUID;
    const to = "2026-08-06";
    const from = addHari(to, -119);
    const [glRows, zcAll] = await Promise.all([
      Q.getDailyGlByProduct(id, from, to),
      Q.getZeroClosingEvents([id], addHari(from, -1), addHari(to, 1)),
    ]);
    const perHari = new Map<string, typeof glRows>();
    for (const r of glRows) perHari.set(r.d, [...(perHari.get(r.d) ?? []), r]);
    const hari = [...perHari.keys()].sort();

    const langgar: string[] = [];
    const fisikPrev = new Map<string, { d: string; v: number | null }>();
    let barisDiperiksa = 0;
    let meledakDijelaskan = 0;
    const penyebutKecil: string[] = [];

    for (const tgl of hari) {
      const a = buildArusMinyak(perHari.get(tgl)!, zcAll.filter((z) => z.d === tgl));
      for (const r of a.rows) {
        barisDiperiksa++;
        if (r.awal !== null && r.teori !== null && Math.abs(r.teori - (r.awal + r.penerimaan - r.penjualan)) > 0.005)
          langgar.push(`${tgl} ${r.nama}: Teori != Awal+Penerimaan-Penjualan`);
        if (r.fisik !== null && r.teori !== null && Math.abs((r.losses ?? NaN) - (r.fisik - r.teori)) > 0.005)
          langgar.push(`${tgl} ${r.nama}: Losses != Fisik-Teori`);
        const prev = fisikPrev.get(r.ckdbbm);
        if (prev && r.awal !== null && prev.v !== null && Math.abs(r.awal - prev.v) > 0.005 && !a.provisional)
          langgar.push(`${tgl} ${r.nama}: carry-in putus (awal ${r.awal} vs fisik ${prev.d} ${prev.v}) tanpa penanda`);
        fisikPrev.set(r.ckdbbm, { d: tgl, v: r.fisik });
        // Nilai stok yang mustahil secara fisik.
        //
        // CATATAN METODE: percobaan pertama memakai batas "|Losses| <= Awal +
        // Penerimaan". Itu SALAH dan menyala 9x pada data sah — batas itu hanya
        // berlaku pada arah RUGI (dan di sana ia vakum, sebab tersirat oleh
        // Fisik >= 0), sedangkan arah UNTUNG memang boleh melebihinya (tangki
        // terisi lebih dari yang terbuku). Batas yang salah dibuang, bukan
        // datanya yang dipaksa cocok.
        for (const [namaKol, v] of [["Awal", r.awal], ["Fisik", r.fisik]] as const) {
          if (v === null) continue;
          if (v < 0 || v >= 200_000)
            langgar.push(`${tgl} ${r.nama}: ${namaKol} ${v} mustahil`);
        }
        // % MELEDAK: dua sebab yang sah & sudah dikenal —
        //   (a) penutup-nol (bertanda), atau
        //   (b) PENYEBUT kecil: penjualan hari itu lebih kecil dari penerimaannya,
        //       jadi rasio didominasi penyebut, bukan numerator yang mustahil.
        // Selain keduanya = tak terjelaskan → pelanggaran.
        if (r.pct !== null && Math.abs(r.pct) > 1000) {
          if (r.zeroClosing) meledakDijelaskan++;
          else if (r.penjualan < r.penerimaan) penyebutKecil.push(`${tgl} ${r.nama}: % ${r.pct.toFixed(0)} (jual ${r.penjualan.toFixed(2)} < terima ${r.penerimaan.toFixed(2)})`);
          else langgar.push(`${tgl} ${r.nama}: |%| ${r.pct.toFixed(0)} tanpa sebab yang dikenal`);
        }
      }
    }
    console.log(
      `\nSAPUAN INTERNAL IB ${from}..${to}: ${hari.length} hari - ${barisDiperiksa} baris - ` +
        `${langgar.length} pelanggaran - ${meledakDijelaskan} ledakan berpenanda penutup-nol - ` +
        `${penyebutKecil.length} ledakan berpenyebut-kecil`,
    );
    for (const x of penyebutKecil) console.log("  ~ " + x);
    for (const l of langgar.slice(0, 20)) console.log("  x " + l);
    expect(hari.length, "jendela kosong = sapuan hampa").toBeGreaterThanOrEqual(90);
    expect(barisDiperiksa).toBeGreaterThan(500);
    expect(langgar).toEqual([]);
  }, 300_000);
});

/** Model produksi untuk (unit, tanggal) — jalur yang sama dengan halaman. */
async function modelUntuk(code: string, date: string) {
  const Q = await import("@/lib/queries");
  const { q } = await import("@/lib/db");
  type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];
  const [u] = await q<{ unit_id: number }>(`SELECT unit_id FROM public.unit WHERE code = $1`, [
    code,
  ]);
  const id = u!.unit_id as SUID;
  const [glRows, zc] = await Promise.all([
    Q.getDailyGlByProduct(id, monthStart(date), date),
    Q.getZeroClosingEvents([id], addHari(date, -1), addHari(date, 1)),
  ]);
  return buildLaporanModel(neutralRaw(glRows, zc), {
    unitCode: code,
    date,
    today: "2026-08-09",
    mi: { month: 8, year: 2026, dayOfMonth: 6, daysInMonth: 31 },
    detail: true,
  });
}

/**
 * Raw netral: hanya `glRows` & `date` yang menentukan `arusMinyak`. Field lain
 * diisi kosong agar harness tidak menyeret query terberat halaman (saldo
 * pelanggan ~100 dtk) hanya untuk memeriksa satu section.
 */
function neutralRaw(
  glRows: Awaited<ReturnType<typeof import("@/lib/queries").getDailyGlByProduct>>,
  zeroClosing: Awaited<ReturnType<typeof import("@/lib/queries").getZeroClosingEvents>> = [],
) {
  const empty = { rp: 0 };
  const TRIO = { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 };
  return {
    prodDay: [],
    glRows,
    zeroClosing,
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
