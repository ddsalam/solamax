import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdminKode, AdminVerdict } from "@/lib/compliance";
import { DO_PRODUCTS } from "@/lib/config";
import {
  alurSelisihNote,
  buildLaporanModel,
  setoranCheck,
  type LaporanRaw,
} from "@/lib/laporan-model";

const raw = {
  prodDay: [
    { ckdbbm: "P1", nama: "Pertalite", vol: 1000, omzet: 10_000_000, harga: 10000 },
    { ckdbbm: "P2", nama: "Pertamax", vol: 500, omzet: 6_000_000, harga: 12000 },
  ],
  glRows: [],
  prodMonth: [{ ckdbbm: "P1", nama: "Pertalite", vol: 30000, omzet: 300_000_000, harga: 10000 }],
  delivMonth: [],
  doDay: [],
  doAnomalies: [],
  doSuspects: [],
  shift: { shifts: 3, last_dtgljam: null },
  corrections: 0,
  cash: [],
  saldo: {
    awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
    akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
  },
  recapPelanggan: [],
  recapEdc: [],
  recapDeposit: [],
  recapPendapatanLain: [],
  recapPengeluaran: [],
  recapSetoran: [],
  terra: [],
  setoranKemarin: [],
} as unknown as LaporanRaw;

const ctx = {
  unitCode: "6478111",
  date: "2026-06-11",
  today: "2026-07-02",
  mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 },
  detail: true,
};

describe("buildLaporanModel", () => {
  it("agregasi omset & sales rows", () => {
    const m = buildLaporanModel(raw, ctx);
    expect(m.sales.rows).toHaveLength(2);
    expect(m.sales.totOmzet).toBe(16_000_000);
    expect(m.header.omzetTotal).toBe(16_000_000);
  });

  it("DO Harian selalu 6 slot; alarm 11 cek", () => {
    const m = buildLaporanModel(raw, ctx);
    expect(m.doHarian.rows).toHaveLength(DO_PRODUCTS.length);
    expect(m.checks).toHaveLength(11);
  });

  it("Rekonsiliasi A = omset; G null saat kas kosong; glMonthly kosong tanpa opname", () => {
    const m = buildLaporanModel(raw, ctx);
    expect(m.rekon.rows.find((r) => r.l === "A")?.val).toBe(16_000_000);
    expect(m.rekon.rows.find((r) => r.l === "G")?.val).toBeNull();
    expect(m.glMonthly.rows).toHaveLength(0);
  });

  it("Sisa DO tersegmentasi: sisaBerjalan + sisaMacet = sisa; totals ikut", () => {
    const withDo = {
      ...raw,
      doDay: [
        // Bakau-like: Solar 128k dengan 72k macet.
        { ckdbbm: "BB-03", nama: "SOLAR", do_awal: 136000, penerimaan: 8000, penebusan: 0, sisa: 128000, sisa_macet: 72000 },
        // Dexlite murni berjalan.
        { ckdbbm: "BB-06", nama: "DEXLITE", do_awal: 4000, penerimaan: 0, penebusan: 0, sisa: 4000, sisa_macet: 0 },
      ],
    } as unknown as LaporanRaw;
    const m = buildLaporanModel(withDo, ctx);
    const solar = m.doHarian.rows.find((r) => r.key === "solar")!;
    expect(solar.sisa).toBe(128000);
    expect(solar.sisaMacet).toBe(72000);
    expect(solar.sisaBerjalan).toBe(56000);
    const dexlite = m.doHarian.rows.find((r) => r.key === "dexlite")!;
    expect(dexlite.sisaMacet).toBe(0);
    expect(dexlite.sisaBerjalan).toBe(4000);
    expect(m.doHarian.totals.sisa).toBe(132000);
    expect(m.doHarian.totals.sisaMacet).toBe(72000);
  });

  it("IB-like (tanpa SO macet): segmen macet 0 di semua baris — tampilan tak berubah", () => {
    const m = buildLaporanModel(raw, ctx); // doDay kosong = tak ada macet
    for (const r of m.doHarian.rows) {
      expect(r.sisaMacet).toBe(0);
      expect(r.sisaBerjalan).toBe(r.sisa);
    }
    expect(m.doHarian.totals.sisaMacet).toBe(0);
    expect(m.doHarian.suspects).toHaveLength(0);
    expect(m.doHarian.suspectsNonaktif).toEqual({ count: 0, liters: 0 });
  });

  it("hari alur-bersih: recon 0 & alurSelisih 0 di semua baris — tanpa sub-baris rekonsiliasi", () => {
    const clean = {
      ...raw,
      doDay: [
        // Dexlite 06-13: 4+4−0−? → sisa 0; alur terserap penuh.
        { ckdbbm: "BB-06", nama: "DEXLITE", do_awal: 4000, penerimaan: 4000, penebusan: 0, sisa: 0, sisa_macet: 0, alur_selisih: 0 },
      ],
    } as unknown as LaporanRaw;
    const m = buildLaporanModel(clean, ctx);
    for (const r of m.doHarian.rows) {
      expect(r.recon).toBe(0);
      expect(r.alurSelisih).toBe(0);
      expect(alurSelisihNote(r.alurSelisih)).toBeNull();
    }
  });

  it("hari break (Bakau 2026-06-13): sub-baris rekonsiliasi = −recon, identitas balance", () => {
    const brokeDay = {
      ...raw,
      doDay: [
        // Solar: 48 + 0 − 16 = 32 alur; sisa 40 → 8.000 penerimaan tak terserap.
        { ckdbbm: "BB-03", nama: "SOLAR", do_awal: 48000, penerimaan: 16000, penebusan: 0, sisa: 40000, sisa_macet: 0, alur_selisih: 8000 },
        // Pertalite: 8 + 0 − 16 = −8 alur; sisa 8 → 16.000 tak terserap (clamp).
        { ckdbbm: "BB-07", nama: "PERTALITE", do_awal: 8000, penerimaan: 16000, penebusan: 0, sisa: 8000, sisa_macet: 0, alur_selisih: 16000 },
      ],
    } as unknown as LaporanRaw;
    const m = buildLaporanModel(brokeDay, ctx);
    const solar = m.doHarian.rows.find((r) => r.key === "solar")!;
    const perta = m.doHarian.rows.find((r) => r.key === "pertalite")!;
    // Kesetaraan dua jalur (query-CTE vs residual aritmetika) — WAJIB sama;
    // ketidaksetaraan = bug yang harus muncul, bukan disembunyikan.
    expect(solar.alurSelisih).toBe(-solar.recon);
    expect(perta.alurSelisih).toBe(-perta.recon);
    expect(solar.alurSelisih).toBe(8000);
    expect(perta.alurSelisih).toBe(16000);
    // Identitas tampilan balance: DO Awal + Penebusan − Penerimaan + selisih = Sisa.
    expect(solar.doAwal + solar.penebusan - solar.penerimaan + solar.alurSelisih).toBe(solar.sisa);
    expect(perta.doAwal + perta.penebusan - perta.penerimaan + perta.alurSelisih).toBe(perta.sisa);
    // Copy KOMPAK (insiden layout 2026-07-13: kalimat panjang + nowrap meledakkan
    // lebar kolom) — pola & panjang setara sub-baris macet yang terbukti.
    expect(alurSelisihNote(solar.alurSelisih)).toBe("8.000 L tak terserap · lihat panel Alokasi");
    // Arah sebaliknya (penebusan terserap kelebihan-terima lama).
    expect(alurSelisihNote(-24000)).toBe("24.000 L terserap lebih-terima lama · lihat panel Alokasi");
  });

  it("suspects terbelah aktif vs nonaktif (aturan tangki, tanpa hardcode nama)", () => {
    const withSuspects = {
      ...raw,
      doSuspects: [
        { cnoso: "4060546316", ckdbbm: "BB-04", nama: "PERTAMAX TURBO", ditebus: 16000, diterima: 0, outstanding: 16000, sejak: "2026-03-15", umur_hari: 119, aktif: true },
        { cnoso: "4023165148", ckdbbm: "BB-01", nama: "PREMIUM", ditebus: 64000, diterima: 0, outstanding: 64000, sejak: "2022-12-30", umur_hari: 1290, aktif: false },
        { cnoso: "4060297050", ckdbbm: "BB-01", nama: "PREMIUM", ditebus: 56000, diterima: 0, outstanding: 56000, sejak: "2026-02-28", umur_hari: 134, aktif: false },
      ],
    } as unknown as LaporanRaw;
    const m = buildLaporanModel(withSuspects, ctx);
    expect(m.doHarian.suspects).toHaveLength(1);
    expect(m.doHarian.suspects[0]!.cnoso).toBe("4060546316");
    expect(m.doHarian.suspectsNonaktif).toEqual({ count: 2, liters: 120000 });
  });
});

// ===========================================================================
// U1 — cek alarm "Setoran Bank Sesuai" (disambungkan 2026-08-09)
// ===========================================================================

describe("setoranCheck — terjemahan vonis, bukan pembuat vonis", () => {
  const v = (kode: AdminKode, tone: "green" | "yellow" | "red" | "pending"): AdminVerdict => ({
    kode,
    tone,
    terisi: true,
  });

  /**
   * Daftar kode DITURUNKAN DARI SUMBER `compliance.ts`, bukan diketik ulang di
   * sini. Idiom yang sama dengan db-budget.test.ts: menambah `AdminKode` baru
   * tanpa menanganinya membuat test ini MERAH, sedangkan daftar hardcode akan
   * tetap hijau dan berbohong.
   */
  const SUMBER = readFileSync(join(__dirname, "compliance.ts"), "utf8");
  // Ambil BLOK union-nya dulu, baru literalnya. Satu regex baris-demi-baris yang
  // menuntut komentar `//` akan memerah hanya karena komentarnya dihapus —
  // penjaga yang berbunyi saat tak ada yang rusak akan dimatikan orang.
  const BLOK = SUMBER.match(/export type AdminKode =([\s\S]*?);/)?.[1] ?? "";
  const KODE = [...BLOK.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as AdminKode);

  it("daftar kode terbaca dari sumber (anti-vakum)", () => {
    // Tanpa ini, regex yang tak cocok lagi membuat loop di bawah beriterasi nol
    // kali dan hijau selamanya.
    expect(KODE.length).toBeGreaterThanOrEqual(12);
    expect(KODE).toContain("setoran_tersalin");
    expect(KODE).toContain("selaras");
  });

  it("SETIAP kode menghasilkan cek ber-label & ber-catatan (tak ada yang jatuh)", () => {
    for (const k of KODE) {
      const c = setoranCheck(v(k, "red"), 100_000_000, 100_000_000);
      expect(c, `kode ${k} tak tertangani`).toBeDefined();
      expect(c.label.length, `label kosong utk ${k}`).toBeGreaterThan(0);
      expect(c.note.length, `catatan kosong utk ${k}`).toBeGreaterThan(0);
    }
  });

  it("selaras → ok; ketiga bentuk tak-selaras & yang kosong → fail", () => {
    expect(setoranCheck(v("selaras", "green"), 100, 100).state).toBe("ok");
    for (const k of [
      "lebih_setor", "kurang_setor", "setoran_tersalin", "setoran_kosong", "belum_diisi",
    ] as AdminKode[]) {
      expect(setoranCheck(v(k, "red"), 100, 100).state, k).toBe("fail");
    }
  });

  it("semua vonis PENDING → `na`, BUKAN `provisional`", () => {
    // `provisional` membuat nada skor jadi warning. Hari yang memang belum bisa
    // dinilai tak boleh terlihat seperti kabar buruk.
    for (const k of [
      "hari_berjalan", "tak_terhitung", "belum_tempo_terisi", "belum_tempo_kosong", "pra_adopsi",
    ] as AdminKode[]) {
      expect(setoranCheck(v(k, "pending"), 100, 100).state, k).toBe("na");
    }
  });

  it("config_hilang → `na` (di luar penyebut), bukan `fail` menuduh pengawas", () => {
    const c = setoranCheck(v("config_hilang", "red"), 100, null);
    expect(c.state).toBe("na");
    expect(c.note).toContain("ADOPSI_RINCIAN");
  });

  it("catatan menyebut ANGKA selisihnya, bukan cuma kata", () => {
    const c = setoranCheck(v("kurang_setor", "red"), 100_000_000, 95_000_000);
    expect(c.note).toContain("5.000.000");
  });
});

describe("alarm Laporan — U1 tersambung, U-lainnya tetap N/A", () => {
  it("'Setoran Bank Sesuai' masuk penyebut saat hari lampau terisi & selaras", () => {
    const m = buildLaporanModel(
      {
        ...raw,
        // H = A(16 jt) − (B+C+D = 0) + F(1 jt) − G(0) = 17 jt → I harus 17 jt.
        recapPendapatanLain: [{ id: "f", keterangan: "x", amount: 1_000_000, urut: 1 }],
        recapSetoran: [{ id: "s", keterangan: "SETOR", amount: 17_000_000, urut: 1 }],
      } as unknown as LaporanRaw,
      { ...ctx, date: "2026-08-01", today: "2026-08-09" },
    );
    const c = m.checks.find((x) => x.label.startsWith("Setoran Bank"));
    expect(c?.state).toBe("ok");
  });

  it("'Pengeluaran Sudah Disahkan' SENGAJA tetap na — datanya memang tak ada", () => {
    const m = buildLaporanModel(raw, ctx);
    const c = m.checks.find((x) => x.label === "Pengeluaran Sudah Disahkan");
    expect(c?.state).toBe("na");
    expect(c?.note).toContain("pengesahan");
  });
});

describe("penjaga SUMBER: halaman Laporan menyambungkan query yang benar", () => {
  /**
   * Dibaca dari berkas halamannya, bukan ditiru.
   *
   * Halaman Laporan adalah Server Component — daftar query-nya sebaris dan tak
   * bisa di-import, jadi tak ada tes yang bisa MEMANGGIL wiring itu. Yang bisa:
   * MEMBACANYA. Idiom yang sama dengan db-budget.test.ts terhadap db.ts.
   *
   * Yang dijaga khusus: `terra` (komponen B). Baris `terra_resmi` dan
   * `pelanggan` sama-sama `{ liter, rp }`, jadi menyambungkan yang salah LOLOS
   * type-check — dan akibatnya H ter-hitung terlalu besar sehingga setiap hari
   * terlihat "kurang setor".
   */
  const HALAMAN = readFileSync(
    join(__dirname, "..", "app", "(app)", "unit", "[code]", "laporan", "[date]", "page.tsx"),
    "utf8",
  );

  it("berkas halamannya benar-benar terbaca (anti-vakum)", () => {
    expect(HALAMAN).toContain("buildLaporanModel");
    expect(HALAMAN.length).toBeGreaterThan(2000);
  });

  it("`terra` diisi getTerraResmiForDate, dan halaman memang memanggilnya", () => {
    expect(HALAMAN).toContain("getTerraResmiForDate(unit.unit_id, date)");
    // Urutan destructuring ↔ urutan Promise.all: `terra` harus tepat sebelum
    // `setoranKemarin`, sama seperti kedua query-nya.
    const iTerraVar = HALAMAN.indexOf("    terra,");
    const iKemarinVar = HALAMAN.indexOf("    setoranKemarin,");
    const iTerraQ = HALAMAN.indexOf("getTerraResmiForDate(");
    const iKemarinQ = HALAMAN.indexOf('addDays(date, -1), "setoran_tunai"');
    for (const [n, i] of Object.entries({ iTerraVar, iKemarinVar, iTerraQ, iKemarinQ })) {
      expect(i, `${n} tak ditemukan`).toBeGreaterThan(-1);
    }
    expect(iTerraVar).toBeLessThan(iKemarinVar);
    expect(iTerraQ).toBeLessThan(iKemarinQ);
  });

  it("setoran D−1 diambil dari tanggal SEBELUMNYA, bukan tanggal yang sama", () => {
    expect(HALAMAN).toContain('getManualEntries(unit.unit_id, addDays(date, -1), "setoran_tunai")');
  });
});
