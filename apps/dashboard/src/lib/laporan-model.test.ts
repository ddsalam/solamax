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
  zeroClosing: [],
  prodMonth: [{ ckdbbm: "P1", nama: "Pertalite", vol: 30000, omzet: 300_000_000, harga: 10000 }],
  delivMonth: [],
  doDay: [],
  doAnomalies: [],
  doSuspects: [],
  shift: { shifts: 3, last_dtgljam: null },
  hargaDeviasi: [],
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
  tetanggaSebelum: { f: [], g: [], i: [] },
  tetanggaSesudah: { f: [], g: [], i: [] },
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
    // 12 sejak 2026-08-24: "Harga Beli/Jual Benar" dipecah menjadi cek harga
    // JUAL yang aktif + "Harga Beli Benar" yang tetap na (datanya belum ada).
    expect(m.checks).toHaveLength(12);
  });

  it("Rekonsiliasi A = omset; G null saat kas kosong; glMonthly kosong tanpa opname", () => {
    const m = buildLaporanModel(raw, ctx);
    expect(m.rekon.rows.find((r) => r.l === "A")?.val).toBe(16_000_000);
    expect(m.rekon.rows.find((r) => r.l === "G")?.val).toBeNull();
    expect(m.glMonthly.rows).toHaveLength(0);
  });

  it("permukaan agregat tetap merender tiga baris selama transisi snapshot", () => {
    const m = buildLaporanModel({
      ...raw,
      saldo: {
        awal: { piutangLokal: 10, piutangOnline: 3, hutangLokal: -2 },
        akhir: { piutangLokal: 20, piutangOnline: 4, hutangLokal: -5 },
      },
    }, ctx);
    expect(m.recap.hasSaldo).toBe(true);
    expect(m.recap.saldoRows).toEqual([
      { label: "Saldo Piutang Pelanggan Lokal", awal: 10, akhir: 20 },
      { label: "Saldo Piutang Pelanggan Online", awal: 3, akhir: 4 },
      { label: "Saldo Hutang Pelanggan Lokal", awal: -2, akhir: -5, danger: true },
    ]);
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

  /**
   * Kejadian nyata yang membuka cek ini: Korek 23 Agu 2026 shift 3, Dexlite
   * direkam Rp 7.850/L (harga produk PLK) alih-alih Rp 20.150/L.
   */
  const devKorek = [
    {
      unit_id: 6, d: "2026-08-23", ckdbbm: "BB-06", nama: "DEXLITE", nshift: 3,
      harga: 7850, vol: 334.95, dom: 20150, dom_prev: 20150, dom_next: 20150,
    },
  ];

  it("'Harga jual' FAIL saat harga produk lain nyasar ke satu shift", () => {
    const m = buildLaporanModel(
      { ...raw, hargaDeviasi: devKorek } as unknown as LaporanRaw,
      ctx,
    );
    const c = m.checks.find((x) => x.label.startsWith("Harga jual"));
    expect(c?.state).toBe("fail");
    expect(c?.note).toContain("4.119.885"); // 334,95 L × (20.150 − 7.850)
    expect(c?.note).toContain("Rekapan Per Shift"); // arahkan ke POS, bukan ke sini
  });

  it("'Harga jual' provisional saat hari berikutnya belum ada — bukan menuduh", () => {
    const m = buildLaporanModel(
      {
        ...raw,
        hargaDeviasi: [{ ...devKorek[0]!, dom_next: null }],
      } as unknown as LaporanRaw,
      ctx,
    );
    expect(m.checks.find((x) => x.label.startsWith("Harga jual"))?.state).toBe("provisional");
  });

  it("'Harga jual' ok saat deviasinya terjelaskan perubahan harga", () => {
    const m = buildLaporanModel(
      {
        ...raw,
        // 13.800 = harga dominan KEMARIN → shift yang masih memakai harga lama.
        hargaDeviasi: [{ ...devKorek[0]!, harga: 13800, dom: 13900, dom_prev: 13800, dom_next: 13900 }],
      } as unknown as LaporanRaw,
      ctx,
    );
    expect(m.checks.find((x) => x.label.startsWith("Harga jual"))?.state).toBe("ok");
  });

  it("'Harga jual' na saat hari itu tak ada penjualan — bukan ok", () => {
    const m = buildLaporanModel(
      { ...raw, prodDay: [], hargaDeviasi: [] } as unknown as LaporanRaw,
      ctx,
    );
    expect(m.checks.find((x) => x.label.startsWith("Harga jual"))?.state).toBe("na");
  });

  it("'Harga Beli Benar' tetap na — dipecah agar tak menghijau atas bukti separuh", () => {
    const m = buildLaporanModel(
      { ...raw, hargaDeviasi: [] } as unknown as LaporanRaw,
      ctx,
    );
    expect(m.checks.find((x) => x.label === "Harga Beli Benar")?.state).toBe("na");
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
    // blok tetangga, sama seperti kedua kelompok query-nya.
    const iTerraVar = HALAMAN.indexOf("    terra,");
    const iTetanggaVar = HALAMAN.indexOf("    fKemarin, gKemarin, iKemarin, fBesok, gBesok, iBesok,");
    const iTerraQ = HALAMAN.indexOf("getTerraResmiForDate(");
    const iTetanggaQ = HALAMAN.indexOf('addDays(date, -1), "pendapatan_lain"');
    for (const [n, i] of Object.entries({ iTerraVar, iTetanggaVar, iTerraQ, iTetanggaQ })) {
      expect(i, `${n} tak ditemukan`).toBeGreaterThan(-1);
    }
    expect(iTerraVar).toBeLessThan(iTetanggaVar);
    expect(iTerraQ).toBeLessThan(iTetanggaQ);
  });

  it("screen explanations use neutral G/L wording in both final and provisional branches", () => {
    expect(HALAMAN.match(/G\/L harian \(metode RESUME:/g)).toHaveLength(2);
    expect(HALAMAN).not.toContain("Losses harian");
  });

  it("tetangga diambil DUA ARAH: D−1 dan D+1, ketiga seksinya", () => {
    // Aturan satu arah menangkap 0 dari 1 kejadian nyata. Kalau salah satu dari
    // enam query ini hilang, tetangganya jadi setengah dan kebutaan itu kembali.
    for (const arah of ["-1", "1"]) {
      for (const seksi of ["pendapatan_lain", "pengeluaran", "setoran_tunai"]) {
        expect(
          HALAMAN,
          `query ${seksi} D${arah === "-1" ? "−1" : "+1"} hilang`,
        ).toContain(`getManualEntries(unit.unit_id, addDays(date, ${arah}), "${seksi}")`);
      }
    }
  });
});

describe("operational G/L null propagation", () => {
  const gl = (ckdbbm: string, value: number | null, d = ctx.date, provisional = false) => ({
    d, ckdbbm, nama: ckdbbm, fisik_prev: 1_000, fisik: value === null ? null : 990 + value,
    pen_do: 0, sales_gross: 10, tera: 0, gl: value, movement_invalid: false, excluded_tanks: value === null ? 1 : 0, provisional,
  });

  it.each([
    { value: 4000, provisional: false, signed: "+4.000", state: "fail" },
    { value: -4000, provisional: false, signed: "−4.000", state: "fail" },
    { value: 4000, provisional: true, signed: "+4.000", state: "provisional" },
    { value: -4000, provisional: true, signed: "−4.000", state: "provisional" },
    { value: 0, provisional: false, signed: "0", state: "ok" },
  ])("uses neutral daily/monthly alarm labels for $value (provisional=$provisional)", ({ value, provisional, signed, state }) => {
    const products = [{ ...raw.prodDay[0]!, vol: 8200 }];
    const m = buildLaporanModel({ ...raw, prodDay: products, prodMonth: products,
      glRows: [{ ...gl("P1", value, ctx.date, provisional), fisik_prev: 20000, fisik: 11800 + value, sales_gross: 8200 }],
    }, ctx);
    expect(m.sales.glTotal).toBe(value);
    expect(m.glMonthly.glMonthTotal).toBe(value);
    const checks = m.checks.filter((c) => /^(G\/L|Losses) (harian|bulanan)/.test(c.label));
    expect(checks).toHaveLength(2);
    for (const [i, check] of checks.entries()) {
      expect(check.state).toBe(state);
      expect(check.label).toBe(`G/L ${i === 0 ? "harian" : "bulanan"}${provisional ? " — sementara" : value === 0 ? " aman" : " di atas ambang"}`);
      expect(check.note).toContain(`${signed} L`);
      expect(check.note).toContain(provisional ? "belum final" : value === 0 ? "0,00%" : "48,78%");
    }
  });

  it("unknown product and partial daily/monthly totals stay unavailable in both panels", () => {
    const m = buildLaporanModel({ ...raw, glRows: [gl("P1", 5), gl("P2", null)] }, ctx);
    expect(m.sales.rows.find(r => r.ckdbbm === "P1")!.gl).toBe(5);
    expect(m.sales.rows.find(r => r.ckdbbm === "P2")!.gl).toBeNull();
    expect(m.sales.glTotal).toBeNull(); expect(m.sales.glPctDay).toBeNull();
    expect(m.arusMinyak.total.losses).toBeNull(); expect(m.arusMinyak.total.pct).toBeNull();
    expect(m.glMonthly.rows.find(r => r.ckdbbm === "P2")!.selisih).toBeNull();
    expect(m.glMonthly.glMonthTotal).toBeNull(); expect(m.glMonthly.glPctMonth).toBeNull();
    const monthly = m.checks.find(r => r.label.startsWith("G/L bulanan"))!;
    expect(monthly.state).toBe("na"); expect(monthly.label).not.toContain("aman");
  });

  it("unknown earlier row invalidates only that product's monthly sum and full monthly total", () => {
    const m = buildLaporanModel({ ...raw,
      glRows: [gl("P1", null, "2026-06-10"), gl("P1", 5), gl("P2", 3)],
    }, ctx);
    expect(m.sales.glTotal).toBe(8);
    expect(m.arusMinyak.total.losses).toBe(8);
    expect(m.glMonthly.rows.find(r => r.ckdbbm === "P1")!.selisih).toBeNull();
    expect(m.glMonthly.rows.find(r => r.ckdbbm === "P2")!.selisih).toBe(3);
    expect(m.glMonthly.glMonthTotal).toBeNull();
  });

  it("computed provisional G/L stays visible with provisional monthly alarm", () => {
    const m = buildLaporanModel({ ...raw, glRows: [gl("P1", 5, ctx.date, true), gl("P2", 3)] }, ctx);
    expect(m.sales.glTotal).toBe(8);
    expect(m.sales.glProvisional).toBe(true);
    expect(m.glMonthly.glMonthTotal).toBe(8);
    expect(m.glMonthly.provisional).toBe(true);
    expect(m.checks.find(r => r.label.startsWith("G/L bulanan"))!.state).toBe("provisional");
  });

  it("no G/L rows is unavailable and cannot produce a safe monthly alarm", () => {
    const m = buildLaporanModel(raw, ctx);
    expect(m.sales.glTotal).toBeNull(); expect(m.glMonthly.glMonthTotal).toBeNull();
    expect(m.checks.find(r => r.label.startsWith("G/L bulanan"))!.state).toBe("na");
  });

  it("an active sales product absent from G/L prevents partial daily and Arus totals", () => {
    const m = buildLaporanModel({ ...raw, glRows: [gl("P1", 0)] }, ctx);
    expect(m.sales.rows.find(r => r.ckdbbm === "P1")!.gl).toBe(0); // known zero stays known
    expect(m.sales.rows.find(r => r.ckdbbm === "P2")!.gl).toBeNull();
    expect(m.sales.glTotal).toBeNull(); expect(m.sales.glPctDay).toBeNull();
    expect(m.arusMinyak.total.losses).toBeNull(); expect(m.arusMinyak.total.pct).toBeNull();
    expect(m.arusMinyak.total).toMatchObject({ awal: null, teori: null, fisik: null });
    expect(m.arusMinyak.incomplete).toBe(true);
  });

  it("active monthly product without any G/L prevents partial month total", () => {
    const m = buildLaporanModel({ ...raw, glRows: [gl("P1", 0)], prodMonth: raw.prodDay }, ctx);
    expect(m.glMonthly.glMonthTotal).toBeNull(); expect(m.glMonthly.glPctMonth).toBeNull();
    expect(m.checks.find(r => r.label.startsWith("G/L bulanan"))!.state).toBe("na");
  });

  // Synthetic source artefact: closing placeholder 0 while theory says ~990 L+.
  const artefact = (ckdbbm: string, reason: "penutup_nol" | "jangkar_nol", d = ctx.date) => ({
    ...gl(ckdbbm, 0, d), fisik_prev: 5_000, fisik: 0, sales_gross: 10, gl: null, gl_raw: -4_990,
    gl_suspect: reason, excluded_tanks: 0, provisional: true,
  });

  it.each(["penutup_nol", "jangkar_nol"] as const)(
    "artefact %s is withheld from product, day, Arus and month totals but stays auditable", (reason) => {
      const m = buildLaporanModel({ ...raw, glRows: [artefact("P1", reason), gl("P2", 3)] }, ctx);
      expect(m.sales.rows.find(r => r.ckdbbm === "P1")!.gl).toBeNull();
      expect(m.sales.rows.find(r => r.ckdbbm === "P2")!.gl).toBe(3);
      expect(m.sales.glTotal).toBeNull(); expect(m.sales.glPctDay).toBeNull();
      expect(m.sales.glProvisional).toBe(true);
      const daily = m.checks.find(r => r.label.startsWith("G/L harian"))!;
      expect(daily).toMatchObject({ state: "na", label: "G/L harian — perlu periksa data sumber" });
      expect(daily.note).toContain("bukan kerugian");
      const monthly = m.checks.find(r => r.label.startsWith("G/L bulanan"))!;
      expect(monthly).toMatchObject({ state: "na", label: "G/L bulanan — perlu periksa data sumber" });
      expect(m.glMonthly.rows.find(r => r.ckdbbm === "P1")!.selisih).toBeNull();
      expect(m.glMonthly.glMonthTotal).toBeNull(); expect(m.glMonthly.glPctMonth).toBeNull();
      const arus = m.arusMinyak.rows.find(r => r.ckdbbm === "P1")!;
      // Raw inputs remain for audit; the artefact is never a Losses figure.
      expect(arus).toMatchObject({ awal: 5_000, fisik: 0, teori: 4_990, losses: null, pct: null,
        artefak: reason, glMentah: -4_990 });
      expect(m.arusMinyak.rows.find(r => r.ckdbbm === "P2")).toMatchObject({ losses: 3, artefak: null, glMentah: null });
      expect(m.arusMinyak.total.losses).toBeNull(); expect(m.arusMinyak.total.pct).toBeNull();
      expect(m.arusMinyak.incomplete).toBe(true);
    });

  it("an earlier-day artefact leaves the clean day intact but gates the month", () => {
    const m = buildLaporanModel({ ...raw, glRows: [artefact("P1", "penutup_nol", "2026-06-10"), gl("P1", 5), gl("P2", 3)] }, ctx);
    expect(m.sales.glTotal).toBe(8);
    expect(m.checks.find(r => r.label.startsWith("G/L harian"))!.state).not.toBe("na");
    expect(m.glMonthly.rows.find(r => r.ckdbbm === "P1")!.selisih).toBeNull();
    expect(m.glMonthly.rows.find(r => r.ckdbbm === "P2")!.selisih).toBe(3);
    expect(m.glMonthly.glMonthTotal).toBeNull();
    expect(m.checks.find(r => r.label.startsWith("G/L bulanan"))).toMatchObject({
      state: "na", label: "G/L bulanan — perlu periksa data sumber" });
  });

  it("a legacy numeric zero-closing row without SQL verdict is withheld the same way", () => {
    const legacy = { ...gl("P1", -4_990), fisik_prev: 5_000, fisik: 0 };
    const m = buildLaporanModel({ ...raw, glRows: [legacy, gl("P2", 3)] }, ctx);
    expect(m.sales.rows.find(r => r.ckdbbm === "P1")!.gl).toBeNull();
    expect(m.sales.glTotal).toBeNull();
    expect(m.arusMinyak.rows.find(r => r.ckdbbm === "P1")).toMatchObject({ losses: null, artefak: "penutup_nol" });
  });

  it.each([
    ["guard-excluded tank", { excluded_tanks: 1 }],
    ["invalid movement", { movement_invalid: true }],
    ["non-finite G/L", { gl: Number.POSITIVE_INFINITY }],
  ] as const)("structural %s row is unavailable in product, day, Arus and month totals", (_name, over) => {
    const m = buildLaporanModel({ ...raw, glRows: [{ ...gl("P1", -40), ...over }, gl("P2", 3)] }, ctx);
    expect(m.sales.rows.find(r => r.ckdbbm === "P1")!.gl).toBeNull();
    expect(m.sales.rows.find(r => r.ckdbbm === "P2")!.gl).toBe(3);
    expect(m.sales.glTotal).toBeNull(); expect(m.sales.glPctDay).toBeNull();
    expect(m.glMonthly.rows.find(r => r.ckdbbm === "P1")!.selisih).toBeNull();
    expect(m.glMonthly.glMonthTotal).toBeNull();
    expect(m.arusMinyak.rows.find(r => r.ckdbbm === "P1")).toMatchObject({ losses: null, pct: null, artefak: null });
    expect(m.arusMinyak.total.losses).toBeNull();
    expect(m.arusMinyak.incomplete).toBe(true);
  });

  it("a zero-stock row with theory within 1,000 L is not withheld by the artefact heuristic", () => {
    const empty = { ...gl("P1", 0), fisik_prev: 900, fisik: 0, sales_gross: 900, gl_suspect: null, gl_raw: 0 };
    const m = buildLaporanModel({ ...raw, glRows: [empty, gl("P2", 3)] }, ctx);
    expect(m.sales.glTotal).toBe(3);
    expect(m.arusMinyak.rows.find(r => r.ckdbbm === "P1")).toMatchObject({ losses: 0, artefak: null });
  });
});

/** Synthetic malformed identities must fail closed even before the SQL guard. */
describe("operational product identity boundaries", () => {
  // getSalesByProduct historically declared non-null strings, but SQL/legacy
  // runtime data can still contain NULL. Exercise that boundary explicitly.
  const prod = (code: string | null, nama: string | null = null, vol = 10) => ({
    ckdbbm: code as string, nama: nama as string, vol, omzet: vol * 10000, harga: 10000,
  });
  const gl = (code: string | null, value = 0, nama: string | null = null) => ({
    d: ctx.date, ckdbbm: code, nama, fisik_prev: 100, fisik: 90 + value,
    pen_do: 0, sales_gross: 10, tera: 0, gl: value, movement_invalid: false, excluded_tanks: 0, provisional: false,
  });

  it.each([null, "", "   "])("matching unknown sales/GL identity %j never verifies a zero", (code) => {
    const unknown = prod(code, "SOLAR");
    const m = buildLaporanModel({ ...raw, prodDay: [unknown], prodMonth: [unknown], glRows: [gl(code, 0, "SOLAR")] }, ctx);
    expect(m.sales.rows).toEqual([expect.objectContaining({ ckdbbm: null, nama: "Produk tidak diketahui", gl: null })]);
    expect(m.glMonthly.rows).toEqual([expect.objectContaining({ ckdbbm: null, nama: "Produk tidak diketahui", selisih: null })]);
    expect(m.sales.glTotal).toBeNull();
    expect(m.glMonthly.glMonthTotal).toBeNull();
    expect(m.sales.glProvisional).toBe(true);
    expect(m.glMonthly.provisional).toBe(true);
    expect(m.arusMinyak.rows[0]).toMatchObject({ ckdbbm: null, nama: "Produk tidak diketahui", losses: null });
    expect(m.arusMinyak.total.losses).toBeNull();
    expect(m.checks.filter((c) => c.label.startsWith("G/L")).every((c) => c.state === "na")).toBe(true);
    expect(m.target.rows[0]!.nama).toBe("Produk tidak diketahui");
    expect(m.harga.rows[0]!.nama).toBe("Produk tidak diketahui");
  });

  it("unknown identity on a zero-volume sales row still invalidates group coverage", () => {
    const known = prod("KNOWN", "SOLAR");
    const unknown = prod(null, null, 0);
    const m = buildLaporanModel({ ...raw, prodDay: [known, unknown], prodMonth: [known, unknown], glRows: [gl("KNOWN")] }, ctx);
    expect(m.sales.rows.find((r) => r.ckdbbm === "KNOWN")!.gl).toBe(0);
    expect(m.sales.rows.find((r) => r.ckdbbm === null)!.gl).toBeNull();
    expect(m.sales.glTotal).toBeNull();
    expect(m.glMonthly.glMonthTotal).toBeNull();
    expect(m.arusMinyak.total.losses).toBeNull();
  });

  it("normalizes padded identities and preserves separate nonempty unmapped products", () => {
    const m = buildLaporanModel({ ...raw,
      prodDay: [prod(" X-UNMAPPED "), prod("Y-UNMAPPED", " ")],
      prodMonth: [prod("X-UNMAPPED"), prod(" Y-UNMAPPED ", " ")],
      glRows: [gl("X-UNMAPPED"), gl(" Y-UNMAPPED ", -5)],
    }, ctx);
    expect(m.sales.rows.map((r) => [r.ckdbbm, r.nama, r.gl])).toEqual([
      ["X-UNMAPPED", "X-UNMAPPED", 0], ["Y-UNMAPPED", "Y-UNMAPPED", -5],
    ]);
    expect(m.glMonthly.rows.map((r) => [r.ckdbbm, r.nama, r.selisih, r.vol])).toEqual([
      ["X-UNMAPPED", "X-UNMAPPED", 0, 10], ["Y-UNMAPPED", "Y-UNMAPPED", -5, 10],
    ]);
    expect(m.sales.glTotal).toBe(-5);
    expect(m.glMonthly.glMonthTotal).toBe(-5);
    expect(m.arusMinyak.total.losses).toBe(-5);
    expect(m.sales.glProvisional).toBe(false);
    expect(m.glMonthly.provisional).toBe(false);
  });

  it("a padded invalid source row cannot turn its unpadded aggregate into final zero", () => {
    const known = prod("KNOWN", "SOLAR");
    const m = buildLaporanModel({ ...raw, prodDay: [known], prodMonth: [known],
      glRows: [{ ...gl(" KNOWN "), gl: null, provisional: true }],
    }, ctx);
    expect(m.sales.rows[0]!.gl).toBeNull();
    expect(m.glMonthly.rows[0]!.selisih).toBeNull();
  });
});
