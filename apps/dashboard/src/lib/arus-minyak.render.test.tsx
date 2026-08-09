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
import { gradeArus, parseArusHtml, ringkas, type DeviasiSah } from "@/lib/arus-minyak.grade";
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

d("Arus Minyak vs oracle EasyMax — IB 1–6 Agustus 2026 (dari HTML terender)", () => {
  it(
    "392 sel: 8 baris × 7 kolom × 7 tanggal (6 Agu 2026 + 21 Nov 2025)",
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

      const htmlParts: string[] = [];
      const render: Record<string, Map<string, (number | null)[]>> = {};

      for (const date of Object.keys(ORACLE)) {
        const glRows = await Q.getDailyGlByProduct(unitId, monthStart(date), date);
        const zc = await Q.getZeroClosingEvents([unitId], addHari(date, -1), addHari(date, 1));
        // Jalur model PRODUKSI (filter d===date + urutan) — bukan jalan pintas.
        const model = buildLaporanModel(neutralRaw(glRows, zc), {
          unitCode: UNIT_CODE,
          date,
          today: "2026-08-09",
          mi: { month: 8, year: 2026, dayOfMonth: 6, daysInMonth: 31 },
          detail: true,
        });
        const html = renderToStaticMarkup(<ArusMinyakSection arus={model.arusMinyak} />);
        htmlParts.push(`<h2 style="font:600 16px system-ui">${date}</h2>${html}`);
        render[date] = parseArusHtml(html);
      }

      // Penilaian dipisah ke `arus-minyak.grade.ts` (murni) supaya aturan
      // "absen hanya sah bila SELURUH sel oracle nol" dijaga tes yang jalan di
      // SETIAP commit, bukan oleh mutasi manual yang harus diingat.
      const hasil = gradeArus(ORACLE, render, COLS, DEVIASI_SAH);
      const r = ringkas(hasil);
      const mismatch = hasil
        .filter((h) => h.vonis === "mismatch")
        .map((h) => `${h.tanggal} | ${h.baris} | ${h.kolom} | oracle ${h.oracle} | render ${h.render ?? "ABSEN"}`);

      writeFileSync(
        OUT,
        `<meta charset="utf-8"><style>${CSS.map((f) => readFileSync(join(__dirname, "..", f), "utf8")).join("\n")}</style>` +
          `<body class="lap-page" style="padding:24px;background:var(--color-bg,#f5f6f8)">${htmlParts.join("")}</body>`,
      );
      // Dilaporkan TERPISAH: jendela Agustus lama (336) supaya bisa dibandingkan
      // dengan angka putaran sebelumnya, dan 21 Nov 2025 yang baru (56).
      const sub = (pred: (t: string) => boolean) => ringkas(hasil.filter((h) => pred(h.tanggal)));
      const agu = sub((t) => t.startsWith("2026-08"));
      const nov = sub((t) => t.startsWith("2025-11"));
      console.log(
        `\n  jendela Agustus 2026 (6 tgl): EKSAK ${agu.eksak} · DEVIASI ${agu.deviasi_sah} · ABSEN≡NOL ${agu.absen_nol} · MISMATCH ${agu.mismatch} (total ${agu.total})` +
          `\n  21 Nov 2025 (1 tgl, tera 1.000 L): EKSAK ${nov.eksak} · DEVIASI ${nov.deviasi_sah} · ABSEN≡NOL ${nov.absen_nol} · MISMATCH ${nov.mismatch} (total ${nov.total})`,
      );
      console.log(
        `\nARUS MINYAK vs ORACLE — EKSAK ${r.eksak} · DEVIASI SAH ${r.deviasi_sah} · ` +
          `ABSEN≡NOL ${r.absen_nol} · MISMATCH ${r.mismatch} (total ${r.total})\n` +
          [...new Set(
            hasil
              .filter((h) => h.vonis === "absen_nol" || h.vonis === "deviasi_sah")
              .map((h) => `  · ${h.tanggal} ${h.baris}${h.vonis === "deviasi_sah" ? ` ${h.kolom}` : ""}: ${h.vonis.toUpperCase()} — ${h.catatan}`),
          )].join("\n"),
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

  it("BADGE MENYALA di kelas 1 (Adisucipto 9 Agu) — penutup 0 tanpa jangkar hari berikutnya", async () => {
    const m = await modelUntuk("6478101", "2026-08-09");
    const kena = m.arusMinyak.rows.filter((r) => r.zeroClosing !== null);
    expect(kena.length).toBeGreaterThan(0);
    expect(kena.every((r) => r.zeroClosing!.kelas === 1)).toBe(true);
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
