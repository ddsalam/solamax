/**
 * Arus Minyak Harian — uji formula + pengikat ke ORACLE.
 *
 * Oracle sah: blok ARUS MINYAK "LAPORAN RESUME OPERASIONAL" EasyMax, unit Imam
 * Bonjol 1–6 Agustus 2026 (PNG ditranskripsi di
 * session-notes/2026-08-08-arus-minyak-harian.md, disegel SEBELUM query pertama).
 * Angka komponen di bawah adalah keluaran `getDailyGlByProduct` yang diukur dari
 * DB pilot — jadi tes ini menguji jalur formula, bukan formula menguji dirinya.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArusMinyakSection } from "@/components/laporan/ArusMinyakSection";
import { arusQualityNote, buildArusMinyak, lossPct, losses, stockTeori } from "@/lib/arus-minyak";
import { gradeArus, parseArusHtml, ringkas } from "@/lib/arus-minyak.grade";
import type { DailyGlRow } from "@/lib/queries";

type Comp = {
  ckdbbm: string;
  nama: string;
  fisik_prev: number | null;
  pen_do: number;
  sales_gross: number;
  tera: number;
  fisik: number | null;
};

function row(c: Comp): DailyGlRow {
  const gl =
    c.fisik === null || c.fisik_prev === null
      ? null
      : c.fisik - (c.fisik_prev + c.pen_do - (c.sales_gross - c.tera));
  return {
    d: "2026-08-06",
    ckdbbm: c.ckdbbm,
    nama: c.nama,
    fisik: c.fisik,
    fisik_prev: c.fisik_prev,
    pen_do: c.pen_do,
    sales_gross: c.sales_gross,
    tera: c.tera,
    gl,
    movement_invalid: false,
    excluded_tanks: 0,
    provisional: false,
  };
}

const r2 = (n: number | null): number | null => (n === null ? null : Math.round(n * 100) / 100);

/** 6 Agustus 2026 — komponen terukur dari DB pilot (unit 1). */
const IB_06AGU: Comp[] = [
  { ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: 18685.01, pen_do: 8000, sales_gross: 2859.71, tera: 0, fisik: 23635.74 },
  { ckdbbm: "BB-03", nama: "SOLAR", fisik_prev: 3930.38, pen_do: 16000, sales_gross: 12433.15, tera: 0, fisik: 7550.5 },
  { ckdbbm: "BB-04", nama: "PERTAMAX TURBO", fisik_prev: 5167.93, pen_do: 0, sales_gross: 113.56, tera: 0, fisik: 5060.54 },
  { ckdbbm: "BB-06", nama: "DEXLITE", fisik_prev: 10498.83, pen_do: 8000, sales_gross: 6742.22, tera: 0, fisik: 11738.93 },
  { ckdbbm: "BB-07", nama: "PERTALITE", fisik_prev: 12834.83, pen_do: 24000, sales_gross: 23422.46, tera: 0, fisik: 13219.91 },
  { ckdbbm: "BB-08", nama: "PERTAMINA DEX", fisik_prev: 2766.43, pen_do: 8000, sales_gross: 3003.39, tera: 0, fisik: 13310 },
];

/** Sel oracle 6 Agu: [awal, penerimaan, penjualan, teori, fisik, losses, %]. */
const ORACLE_06AGU: Record<string, number[]> = {
  PERTAMAX: [18685.01, 8000, 2859.71, 23825.3, 23635.74, -189.56, -6.63],
  SOLAR: [3930.38, 16000, 12433.15, 7497.23, 7550.5, 53.27, 0.43],
  "PERTAMAX TURBO": [5167.93, 0, 113.56, 5054.37, 5060.54, 6.17, 5.43],
  DEXLITE: [10498.83, 8000, 6742.22, 11756.61, 11738.93, -17.68, -0.26],
  PERTALITE: [12834.83, 24000, 23422.46, 13412.37, 13219.91, -192.46, -0.82],
  "PERTAMINA DEX": [2766.43, 8000, 3003.39, 7763.04, 13310, 5546.96, 184.69],
  TOTAL: [53883.41, 64000, 48574.49, 69308.92, 74515.62, 5206.7, 10.72],
};

describe("Arus Minyak — reproduksi oracle EasyMax (IB 6 Agu 2026)", () => {
  const a = buildArusMinyak(IB_06AGU.map(row));

  it("ketujuh kolom tiap produk cocok EKSAK ke 2 desimal", () => {
    for (const r of a.rows) {
      const want = ORACLE_06AGU[r.nama];
      expect(want, `produk tak ada di oracle: ${r.nama}`).toBeDefined();
      expect([
        r2(r.awal), r2(r.penerimaan), r2(r.penjualan),
        r2(r.teori), r2(r.fisik), r2(r.losses), r2(r.pct),
      ]).toEqual(want);
    }
  });

  it("baris TOTAL = penjumlahan kolom, dan % TOTAL = ΣLosses/ΣPenjualan", () => {
    const t = a.total;
    expect([
      r2(t.awal), r2(t.penerimaan), r2(t.penjualan),
      r2(t.teori), r2(t.fisik), r2(t.losses), r2(t.pct),
    ]).toEqual(ORACLE_06AGU.TOTAL);

    // Kontrol: rata-rata persen ADALAH jawaban yang berbeda — kalau seseorang
    // mengganti rumus % TOTAL jadi rata-rata, tes di atas harus jatuh, bukan lolos.
    const rerata = a.rows.reduce((s, r) => s + (r.pct ?? 0), 0) / a.rows.length;
    expect(r2(rerata)).not.toEqual(ORACLE_06AGU.TOTAL![6]);
  });

  it("Losses ≡ DailyGlRow.gl — panel Omset & Arus Minyak tak bisa menyimpang", () => {
    const src = IB_06AGU.map(row);
    for (const [i, r] of a.rows.entries()) {
      // a.rows sudah tak urut sama dgn src; cari pasangannya by kode.
      const g = src.find((x) => x.ckdbbm === r.ckdbbm)!;
      expect(r.losses, `baris ${i}`).toBeCloseTo(g.gl!, 6);
    }
  });
});

describe("Arus Minyak — Penjualan bersih-tera (cabang yang diputuskan oracle)", () => {
  // 2 Agu 2026 Dexlite: SATU-SATUNYA sel ber-tera ≠ 0 di rentang oracle. Oracle
  // mencetak Penjualan 3.801,75 & Teori 15.874,04 → tera DIKURANGKAN.
  const g = row({
    ckdbbm: "BB-06", nama: "DEXLITE",
    fisik_prev: 11675.79, pen_do: 8000, sales_gross: 3802.39, tera: 0.64, fisik: 15824.79,
  });
  const a = buildArusMinyak([g]);

  it("Penjualan = jual kotor − tera, bukan kotor", () => {
    expect(r2(a.rows[0]!.penjualan)).toBe(3801.75);
    expect(r2(a.rows[0]!.penjualan)).not.toBe(3802.39); // cabang (a) yang gugur
  });

  it("Stock Teori & Losses ikut oracle (sel kedua yang bebas)", () => {
    expect(r2(a.rows[0]!.teori)).toBe(15874.04);
    expect(r2(a.rows[0]!.losses)).toBe(-49.25);
    expect(r2(a.rows[0]!.pct)).toBe(-1.3);
  });
});

describe("Arus Minyak — formula murni & tepi", () => {
  it("Stock Teori = Awal + Penerimaan − Penjualan; null menular dari Awal", () => {
    expect(stockTeori(100, 50, 30)).toBe(120);
    expect(stockTeori(null, 50, 30)).toBeNull();
  });

  it("Losses = Fisik − Teori; null bila salah satu null", () => {
    expect(losses(120, 100)).toBe(20);
    expect(losses(null, 100)).toBeNull();
    expect(losses(120, null)).toBeNull();
  });

  it("Penjualan = 0 dengan Losses = 0 → 0,00 (persis perilaku oracle baris Premium)", () => {
    expect(lossPct(0, 0)).toBe(0);
  });

  it("Penjualan = 0 dengan Losses ≠ 0 → null, BUKAN 0", () => {
    // 0,00 di sini akan terbaca "tidak ada losses" padahal ada; oracle tak pernah
    // memperlihatkan kasus ini sehingga tak ada perilaku yang wajib ditiru.
    expect(lossPct(-12.5, 0)).toBeNull();
    expect(lossPct(12.5, 0)).toBeNull();
  });

  it("Stock Fisik NULL → Teori tetap terhitung, Losses & % baris/TOTAL kosong", () => {
    const a = buildArusMinyak([
      row({ ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: 100, pen_do: 0, sales_gross: 40, tera: 0, fisik: null }),
      row({ ckdbbm: "BB-03", nama: "SOLAR", fisik_prev: 200, pen_do: 100, sales_gross: 50, tera: 0, fisik: 245 }),
    ]);
    const px = a.rows.find((r) => r.nama === "PERTAMAX")!;
    expect(px.teori).toBe(60);
    expect(px.fisik).toBeNull();
    expect(px.losses).toBeNull();
    expect(px.pct).toBeNull();
    expect(a.incomplete).toBe(true);
    expect(a.provisional).toBe(true); // gl null → jangan mengaku final
    // Only complete columns are totals; an absent physical reading is not 0.
    expect(a.total.fisik).toBeNull();
    expect(a.total.losses).toBeNull();
    expect(a.total.pct).toBeNull();
    expect(a.total.teori).toBe(310);
  });

  it("G/L ditolak query tetap null meskipun seluruh komponen numerik tersedia", () => {
    const valid = row({ ckdbbm: "P", nama: "P", fisik_prev: 100, pen_do: 0,
      sales_gross: 40, tera: 0, fisik: 65 });
    const invalid = { ...valid, ckdbbm: "Q", nama: "Q", gl: null, provisional: true };
    const a = buildArusMinyak([valid, invalid]);
    expect(a.rows[0]!.losses).toBe(5);
    expect(a.rows[1]!.losses).toBeNull();
    expect(a.rows[1]!.pct).toBeNull();
    expect(a.total.losses).toBeNull();
    expect(a.total.pct).toBeNull();
    expect(a.incomplete).toBe(true);
    expect(a.provisional).toBe(true);
    expect(a.rows[1]!.teori).toBe(60); // rejected G/L need not mean rejected movements
  });

  it("Stock Awal NULL (tak ada anchor) → Teori/Losses/% kosong", () => {
    const a = buildArusMinyak([
      row({ ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: null, pen_do: 8000, sales_gross: 100, tera: 0, fisik: 7900 }),
    ]);
    expect(a.rows[0]!.awal).toBeNull();
    expect(a.rows[0]!.teori).toBeNull();
    expect(a.rows[0]!.losses).toBeNull();
    expect(a.rows[0]!.pct).toBeNull();
    expect(a.incomplete).toBe(true);
  });

  it("rejected movements keep diagnostic components but cannot produce Stock Teori", () => {
    const input = { ...row({ ckdbbm: "P", nama: "SYNTHETIC", fisik_prev: 10_000,
      pen_do: 500, sales_gross: 1_000, tera: 0, fisik: 9_000 }),
      movement_invalid: true, gl: null, provisional: true };
    const a = buildArusMinyak([input]);
    expect(a.rows[0]).toMatchObject({ awal: 10_000, penerimaan: 500,
      penjualan: 1_000, teori: null, fisik: 9_000, losses: null, pct: null });
    expect(a.total).toMatchObject({ awal: 10_000, penerimaan: 500, penjualan: 1_000,
      teori: null, fisik: 9_000, losses: null, pct: null });
    expect(a.incomplete).toBe(true);
  });

  it.each([
    ["guard-excluded tank", { excluded_tanks: 1 }, null],
    ["non-finite G/L", { gl: Number.NaN }, 9_000],
  ] as const)("structural %s row keeps diagnostics but never a Losses figure or partial total", (_name, over, fisik) => {
    const input = { ...row({ ckdbbm: "P", nama: "SYNTHETIC", fisik_prev: 10_000,
      pen_do: 500, sales_gross: 1_000, tera: 0, fisik: 9_000 }), ...over };
    const ok = row({ ckdbbm: "Q", nama: "OTHER", fisik_prev: 200, pen_do: 0, sales_gross: 50, tera: 0, fisik: 145 });
    const a = buildArusMinyak([input, ok]);
    // A guard-excluded closing makes product stock a partial tank sum, never Fisik.
    expect(a.rows[0]).toMatchObject({ awal: 10_000, penerimaan: 500, penjualan: 1_000, teori: 9_500,
      fisik, losses: null, pct: null, artefak: null });
    expect(a.rows[1]).toMatchObject({ losses: -5 });
    expect(a.total).toMatchObject({ awal: 10_200, teori: 9_650, losses: null, pct: null });
    expect(a.total.fisik).toBe(fisik === null ? null : 9_145);
    expect(a.incomplete).toBe(true); expect(a.provisional).toBe(true);
  });

  it("missing legacy movement metadata withholds theory and marks the result incomplete", () => {
    const { movement_invalid: _oldShape, ...legacy } = row({ ckdbbm: "P", nama: "SYNTHETIC",
      fisik_prev: 100, pen_do: 0, sales_gross: 40, tera: 0, fisik: 65 });
    const a = buildArusMinyak([legacy as DailyGlRow]);
    expect(a.rows[0]).toMatchObject({ awal: 100, fisik: 65, teori: null, losses: 5 });
    expect(a.total.teori).toBeNull();
    expect(a.incomplete).toBe(true); expect(a.provisional).toBe(true);
  });

  it("a missing prior stock nulls total beginning/theory but preserves complete physical stock", () => {
    const a = buildArusMinyak([
      row({ ckdbbm: "P", nama: "P", fisik_prev: null, pen_do: 0, sales_gross: 40, tera: 0, fisik: 60 }),
      row({ ckdbbm: "Q", nama: "Q", fisik_prev: 200, pen_do: 100, sales_gross: 50, tera: 0, fisik: 245 }),
    ]);
    expect(a.rows[1]!.teori).toBe(250);
    expect(a.total).toMatchObject({ awal: null, teori: null, fisik: 305, losses: null, pct: null });
  });

  it("measured zero stock and theory remain valid totals", () => {
    const a = buildArusMinyak([row({ ckdbbm: "P", nama: "P", fisik_prev: 0,
      pen_do: 0, sales_gross: 0, tera: 0, fisik: 0 })]);
    expect(a.total).toMatchObject({ awal: 0, teori: 0, fisik: 0, losses: 0, pct: 0 });
    expect(a.incomplete).toBe(false); expect(a.provisional).toBe(false);
  });

  it("tanpa baris → stok dan losses TOTAL tidak tersedia, bukan nol terukur", () => {
    const a = buildArusMinyak([]);
    expect(a.rows).toHaveLength(0);
    expect(a.total.penjualan).toBe(0);
    expect(a.total).toMatchObject({ awal: null, teori: null, fisik: null, losses: null, pct: null });
    expect(a.incomplete).toBe(true);
    expect(a.provisional).toBe(true);
  });
});

/**
 * PENJAGA TETAP untuk kelas kegagalan "pemeriksaan lulus JUSTRU karena tak ada
 * yang diperiksa". Baris produk mati sengaja TIDAK dirender (keputusan owner:
 * baris digerakkan data), jadi penilai HARUS memberi nilai pada ketiadaan —
 * dan harus bisa membedakan "absen karena nol" dari "absen karena hilang".
 *
 * Sebelumnya diskriminasi ini hanya pernah dibuktikan lewat mutasi manual pada
 * harness DB-live. Di sini ia diuji tanpa DB, di SETIAP commit.
 */
describe("gradeArus — absen: nol vs hilang", () => {
  const KOL = ["Awal", "Penerimaan", "Penjualan", "Teori", "Fisik", "Losses", "%"];
  const cells = (n: number) => [n, n, n, n, n, n, n];

  it("baris absen dengan oracle SELURUH nol → absen_nol (bukan mismatch)", () => {
    const hasil = gradeArus(
      { "2026-08-01": { PREMIUM: cells(0) } },
      { "2026-08-01": new Map() },
      KOL,
    );
    expect(ringkas(hasil)).toMatchObject({ absen_nol: 7, mismatch: 0, total: 7 });
  });

  it("🔴 baris absen dengan oracle BUKAN nol → mismatch, TIDAK boleh absen_nol", () => {
    const hasil = gradeArus(
      { "2026-08-01": { SOLAR: [2122.45, 24000, 22280.63, 3841.82, 4080.56, 238.74, 1.07] } },
      { "2026-08-01": new Map() },
      KOL,
    );
    expect(ringkas(hasil)).toMatchObject({ absen_nol: 0, mismatch: 7, total: 7 });
    expect(hasil.every((h) => h.catatan === "baris ABSEN dari render")).toBe(true);
  });

  it("satu sel bukan-nol saja sudah cukup — nyaris-mati tetap mismatch", () => {
    const hasil = gradeArus(
      { "2026-08-01": { X: [0, 0, 0, 0, 0, 0.01, 0] } },
      { "2026-08-01": new Map() },
      KOL,
    );
    expect(ringkas(hasil).mismatch).toBe(7);
  });

  it("TANGGAL yang hilang seluruhnya tidak lolos senyap", () => {
    const hasil = gradeArus(
      { "2026-08-01": { SOLAR: cells(5) } },
      {}, // tak ada render sama sekali untuk tanggal itu
      KOL,
    );
    expect(ringkas(hasil).mismatch).toBe(7);
  });

  it("deviasi bernama: hanya sah pada NILAI yang ditentukan, bukan 'apa pun boleh'", () => {
    const dev = { "d|TOTAL": { kolom: 2, nilai: 52909.04, sebab: "uji" } };
    const cocok = gradeArus(
      { d: { TOTAL: [0, 0, 52909.68, 0, 0, 0, 0] } },
      { d: new Map([["TOTAL", [0, 0, 52909.04, 0, 0, 0, 0]]]) },
      KOL,
      dev,
    );
    expect(ringkas(cocok)).toMatchObject({ deviasi_sah: 1, eksak: 6, mismatch: 0 });

    // Nilai lain di kolom yang sama TETAP mismatch — deviasi bukan pintu belakang.
    const meleset = gradeArus(
      { d: { TOTAL: [0, 0, 52909.68, 0, 0, 0, 0] } },
      { d: new Map([["TOTAL", [0, 0, 99999, 0, 0, 0, 0]]]) },
      KOL,
      dev,
    );
    expect(ringkas(meleset).mismatch).toBe(1);
  });

  it('sel "—" (null) tidak dihitung cocok dengan 0', () => {
    const hasil = gradeArus(
      { d: { X: cells(0) } },
      { d: new Map([["X", [null, 0, 0, 0, 0, 0, 0]]]) },
      KOL,
    );
    expect(ringkas(hasil)).toMatchObject({ eksak: 6, mismatch: 1 });
  });
});

describe("parseArusHtml — pembaca DOM", () => {
  const row = (nama: string, sel: string[]) =>
    `<div class="grid-row cols-arus" data-arus-row="${nama}">` +
    `<span class="text-caption w600">${nama}</span>` +
    sel.map((v) => `<span class="right fs16 num">${v}</span>`).join("") +
    `</div>`;

  it("membaca angka id-ID dan '—' apa adanya", () => {
    const got = parseArusHtml(
      row("PERTAMAX", ["18.685,01", "8.000,00", "2.859,71", "23.825,30", "23.635,74", "-189,56", "-6,63"]) +
        row("X", ["—", "0,00", "0,00", "—", "—", "—", "—"]),
    );
    expect(got.get("PERTAMAX")).toEqual([18685.01, 8000, 2859.71, 23825.3, 23635.74, -189.56, -6.63]);
    expect(got.get("X")![0]).toBeNull();
    expect(got.get("X")![1]).toBe(0);
  });

  it("baris yang tak dirender tidak muncul sebagai kunci (dasar diskriminasi absen)", () => {
    expect(parseArusHtml(row("SOLAR", ["1,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00"])).has("PREMIUM")).toBe(false);
  });
});


/**
 * BADGE penutup-nol kelas 1 — DETERMINISTIK.
 *
 * Versi sebelumnya menguji ini pada tanggal HIDUP (Adisucipto 9 Agu, hari
 * berjalan saat itu). Lima hari kemudian opname penutupnya masuk, `fisik` tak
 * lagi 0, dan tesnya MERAH tanpa ada yang rusak. Tes yang bergantung pada "hari
 * ini" membusuk sendiri; kelas-1 justru kelas yang paling fana (ia hanya ada
 * selama hari itu belum punya jangkar). Karena itu ia dikunci di sini, dari
 * baris buatan, bukan dari kalender.
 */
describe("badge penutup-nol kelas 1 (tanpa DB, tanpa kalender)", () => {
  const zc = (c: Partial<Comp>) =>
    buildArusMinyak([
      row({ ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: 22911, pen_do: 8000, sales_gross: 5918, tera: 0, fisik: 0, ...c }),
    ]).rows[0]!;

  it("fisik 0 dengan Teori jauh di atas ambang → kelas 1", () => {
    const r = zc({});
    expect(r.teori).toBe(24993);
    expect(r.zeroClosing).toEqual({ kelas: 1, tangki: [] });
  });

  it("tangki yang MEMANG terjual habis (Teori ≈ 0) TIDAK ditandai", () => {
    // Ini alasan syarat "Teori > 1.000" ada: tanpa itu, setiap tangki kering
    // ikut tertandai dan penandanya jadi kebisingan.
    expect(zc({ fisik_prev: 900, pen_do: 0, sales_gross: 900 })!.zeroClosing).toBeNull();
  });

  it("tepat DI ambang tidak menyala; sedikit di atasnya menyala", () => {
    expect(zc({ fisik_prev: 1000, pen_do: 0, sales_gross: 0 }).teori).toBe(1000);
    expect(zc({ fisik_prev: 1000, pen_do: 0, sales_gross: 0 }).zeroClosing).toBeNull();
    expect(zc({ fisik_prev: 1000.01, pen_do: 0, sales_gross: 0 }).zeroClosing).not.toBeNull();
  });

  it("fisik bukan 0 → tidak menyala, sebesar apa pun Losses-nya", () => {
    expect(zc({ fisik: 0.01 }).zeroClosing).toBeNull();
  });

  it("kelas 2 MENANG atas kelas 1 bila detektor tertala ikut menyala", () => {
    const a = buildArusMinyak(
      [row({ ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: 22911, pen_do: 8000, sales_gross: 5918, tera: 0, fisik: 0 })],
      [{ unit_id: 1, d: "2026-08-06", ckdtangki: "T-05", ckdbbm: "BB-02", nama: "PERTAMAX", bk: 1, prev: 1, next: 1, recv_next: 0 }],
    );
    expect(a.rows[0]!.zeroClosing).toEqual({ kelas: 2, tangki: ["T-05"] });
  });

  it("peringatan lama pada G/L kanonis yang tampil tidak mengklaim batas deviasi ataupun kerugian", () => {
    // Synthetic: a legitimately emptied tank refilled with a recorded surplus
    // above 1.000 L can still trip the legacy detector; its G/L stays measured.
    const a = buildArusMinyak(
      [row({ ckdbbm: "BB-02", nama: "PERTAMAX", fisik_prev: 0, pen_do: 5000, sales_gross: 0, tera: 0, fisik: 6500 })],
      [{ unit_id: 1, d: "2026-08-06", ckdtangki: "T-05", ckdbbm: "BB-02", nama: "PERTAMAX", bk: 0, prev: 5000, next: 6500, recv_next: 5000 }],
    );
    expect(a.rows[0]).toMatchObject({ losses: 1500, artefak: null, zeroClosing: { kelas: 2 } });
    const note = arusQualityNote(a, (v) => String(v))!;
    expect(note).toContain("hasil ukur kanonis");
    expect(note).toContain("tidak membuktikan kerugian maupun saldo yang tidak sah");
    expect(note).not.toMatch(/≤ 1\.000|BUKAN kerugian/);
    const h = renderToStaticMarkup(createElement(ArusMinyakSection, { arus: a }));
    expect(h).not.toContain("artefak input");
  });
});

/** Synthetic boundary cases: an absent source identity is never a measured zero. */
describe("Arus Minyak — missing source product identities", () => {
  const synthetic = (code: string | null, gl = 0): DailyGlRow => ({
    d: "2026-10-01", ckdbbm: code, nama: "SOLAR", fisik_prev: 100,
    pen_do: 0, sales_gross: 10, tera: 0, fisik: 90, gl,
    movement_invalid: false, excluded_tanks: 0, provisional: false,
  });
  const zero = (code: string | null): import("./queries").ZeroClosingRow => ({
    unit_id: 1, d: "2026-10-01", ckdtangki: "SYNTHETIC-TANK", ckdbbm: code,
    nama: "SOLAR", bk: 2000, prev: 2000, next: 2000, recv_next: 0,
  });

  it.each([null, "", "   "])("unknown code %j cannot crash or masquerade as known zero", (code) => {
    const a = buildArusMinyak([synthetic("BB-03"), synthetic(code)], [zero(code)]);
    expect(a.rows).toHaveLength(2);
    expect(a.rows[0]).toMatchObject({ ckdbbm: "BB-03", nama: "SOLAR", losses: 0, pct: 0, zeroClosing: null });
    expect(a.rows[1]).toMatchObject({ ckdbbm: null, nama: "Produk tidak diketahui", losses: null, pct: null });
    expect(a.total.losses).toBeNull();
    expect(a.total.pct).toBeNull();
    expect(a.total).toMatchObject({ awal: null, teori: null, fisik: null });
    expect(a.incomplete).toBe(true);
    expect(a.provisional).toBe(true);
  });

  it.each([null, "", "   "])("unidentified zero-closing %j cannot bless a known-only subtotal", (code) => {
    const a = buildArusMinyak([synthetic("BB-03", -5)], [zero(code)]);
    expect(a.rows[0]).toMatchObject({ losses: -5, zeroClosing: null });
    expect(a.total).toMatchObject({ awal: null, teori: null, fisik: null });
    expect(a.total.losses).toBeNull();
    expect(a.total.pct).toBeNull();
    expect(a.incomplete).toBe(true);
    expect(a.provisional).toBe(true);
  });

  it("renders the query's unassigned diagnostic row separately with unavailable losses", () => {
    const unknown = { ...synthetic(null), nama: null, fisik: null, fisik_prev: null,
      gl: null, provisional: true };
    const a = buildArusMinyak([synthetic("BB-03"), unknown], [zero(null)]);
    const html = renderToStaticMarkup(createElement(ArusMinyakSection, { arus: a }));
    const cells = parseArusHtml(html);
    expect(cells.get("SOLAR")?.slice(-2)).toEqual([0, 0]);
    expect(cells.get("Produk tidak diketahui")?.slice(-2)).toEqual([null, null]);
    expect(cells.get("TOTAL")?.slice(-2)).toEqual([null, null]);
    expect(html).toContain("belum final");
    expect(html).toContain("total G/L yang bergantung padanya belum tersedia");
    expect(html).not.toContain("tidak ikut TOTAL");
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it("keeps nonempty unmapped codes distinct and preserves their measured zero", () => {
    const a = buildArusMinyak([
      { ...synthetic(" X-UNMAPPED "), nama: null },
      { ...synthetic("Y-UNMAPPED", -5), nama: " " },
      synthetic("BB-03", 7),
    ]);
    expect(a.rows.map((r) => [r.ckdbbm, r.nama, r.losses])).toEqual([
      ["X-UNMAPPED", "X-UNMAPPED", 0], ["Y-UNMAPPED", "Y-UNMAPPED", -5], ["BB-03", "SOLAR", 7],
    ]);
    expect(a.total.losses).toBe(2);
    expect(a.incomplete).toBe(false);
    expect(a.provisional).toBe(false);
  });

  it("matches zero-closing diagnostics only by a nonempty normalized code", () => {
    const a = buildArusMinyak([synthetic(" BB-03 "), synthetic("X-UNMAPPED")], [zero(" BB-03 ")]);
    expect(a.rows[0]!.zeroClosing).toEqual({ kelas: 2, tangki: ["SYNTHETIC-TANK"] });
    expect(a.rows[1]!.zeroClosing).toBeNull();
  });
});
