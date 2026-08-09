/**
 * Model Laporan Operasional Harian — SUMBER TUNGGAL untuk render layar DAN ekspor
 * PDF. Murni (tanpa I/O); dibangun dari hasil query yang SUDAH ber-scope
 * (ScopedUnitId). Semua derivasi (alarm, G/L RESUME, DO, target, recap, rekon)
 * dihitung SEKALI di sini → angka PDF identik dengan layar "ke rupiah". Konsumen
 * (page.tsx & laporan-doc.ts) memformat via lib/format yang sama.
 */
import {
  adopsiRincian,
  canonicalProductKey,
  classifyProduct,
  DO_PRODUCTS,
  resolveDoProduct,
  targetVolumePerDay,
} from "@/lib/config";
import {
  adminStatus,
  fmtRp,
  SETORAN_TOLERANSI_RP,
  type AdminVerdict,
  type TetanggaHari,
} from "@/lib/compliance";
import { aggregateDailyGl, alarmScore, bauran, glPercent, type AlarmCheck } from "@/lib/derive";
import { fmtL, parenNeg, pct, signed } from "@/lib/format";
import { uangTunai } from "@/lib/rekon";
import type * as Q from "@/lib/queries";

/** Bentuk kembalian monthInfo() (tak diekspor sebagai tipe di lib/periods). */
interface MonthCtx {
  month: number;
  year: number;
  dayOfMonth: number;
  daysInMonth: number;
}

type Prod = Awaited<ReturnType<typeof Q.getSalesByProduct>>[number];
type GlRow = Awaited<ReturnType<typeof Q.getDailyGlByProduct>>[number];
type Deliv = Awaited<ReturnType<typeof Q.getDeliveryByProduct>>[number];
type DoRow = Awaited<ReturnType<typeof Q.getDoHarian>>[number];
type DoAnom = Awaited<ReturnType<typeof Q.getDoAnomalies>>[number];
type DoSuspect = Awaited<ReturnType<typeof Q.getDoSuspectSO>>[number];
type Shift = Awaited<ReturnType<typeof Q.getShiftInfo>>;
type Cash = Awaited<ReturnType<typeof Q.getCashForDate>>[number];
type Saldo = Awaited<ReturnType<typeof Q.getSaldoPelanggan>>;
type Manual = Awaited<ReturnType<typeof Q.getManualEntries>>[number];
type RpRow = { rp: number };

export type Tone = "success" | "warning" | "danger";

export interface SalesRow {
  ckdbbm: string;
  nama: string;
  vol: number;
  gl: number | null;
  tera: number;
  omzet: number;
}
export interface GlMonthRow {
  ckdbbm: string;
  nama: string;
  selisih: number;
  vol: number;
}
export interface TargetRow {
  ckdbbm: string;
  nama: string;
  vol: number;
  avgPerDay: number;
  terima: number;
  alok: number | null;
  sel: number | null;
}
export interface DoHarianRow {
  key: string;
  label: string;
  doAwal: number;
  penerimaan: number;
  penebusan: number;
  sisa: number;
  /** Segmen `sisa` dari SO macet (>DO_STALE_DAYS; definisi = panel suspect). */
  sisaMacet: number;
  /** Segmen `sisa` berjalan (≤DO_STALE_DAYS) = sisa − sisaMacet. */
  sisaBerjalan: number;
  recon: number;
  /**
   * Selisih alur per-SO (signed, dari query — jalur data yang sama dgn Sisa):
   * >0 penerimaan tak terserap ke SO-nya; <0 penebusan terserap kelebihan-terima
   * lama. ≡ −recon by construction (di-pin unit test); baris ⚠ balance visual:
   * DO Awal + Penebusan − Penerimaan + alurSelisih = Sisa.
   */
  alurSelisih: number;
}
export interface HargaRow {
  ckdbbm: string;
  nama: string;
  harga: number | null;
}
export interface RekonRow {
  l: string;
  label: string;
  val: number | null;
  op?: string;
  em?: boolean;
  formula?: string;
}

export interface LaporanModel {
  detail: boolean;
  header: {
    isPartial: boolean;
    shifts: number;
    lastDtgljam: string | null;
    scoreText: string;
    scoreTone: Tone;
    provisionalCount: number;
    fail: number;
    omzetTotal: number;
  };
  checks: AlarmCheck[]; // termasuk "na"; konsumen memfilter untuk tampil
  sales: {
    rows: SalesRow[];
    totVol: number;
    totOmzet: number;
    glTotal: number;
    totTera: number;
    glPctDay: number | null;
    glProvisional: boolean;
    glGarbageCount: number;
    gasMix: number | null;
    oilMix: number | null;
  };
  recap: {
    hasRecap: boolean;
    hasSaldo: boolean;
    saldoRows: { label: string; awal: number; akhir: number; danger?: boolean }[];
    recapBoxes: { label: string; val: number; note: string }[];
  };
  glMonthly: {
    rows: GlMonthRow[];
    glMonthTotal: number;
    glPctMonth: number | null;
  };
  target: { rows: TargetRow[] };
  doHarian: {
    rows: DoHarianRow[];
    totals: {
      doAwal: number;
      penerimaan: number;
      penebusan: number;
      sisa: number;
      sisaMacet: number;
    };
    /** Daftar SO macet produk AKTIF (daftar-kerja; nonaktif diringkas terpisah). */
    suspects: DoSuspect[];
    /** Ringkasan SO macet produk NONAKTIF (mis. PREMIUM) — informasional. */
    suspectsNonaktif: { count: number; liters: number };
    anomRows: (DoAnom & { label: string })[];
  };
  harga: { rows: HargaRow[] };
  rekon: { rows: RekonRow[]; cashTotal: number };
  corrections: number;
}

export interface LaporanRaw {
  prodDay: Prod[];
  glRows: GlRow[];
  prodMonth: Prod[];
  delivMonth: Deliv[];
  doDay: DoRow[];
  doAnomalies: DoAnom[];
  doSuspects: DoSuspect[];
  shift: Shift;
  corrections: number;
  cash: Cash[];
  saldo: Saldo;
  recapPelanggan: RpRow[];
  recapEdc: RpRow[];
  recapDeposit: RpRow[];
  recapPendapatanLain: Manual[];
  recapPengeluaran: Manual[];
  recapSetoran: Manual[];
  /**
   * TERRA (komponen B). WAJIB, bukan opsional: tanpa B, H = A − (B+C+D) + F − G
   * ter-hitung terlalu BESAR dan setiap hari akan terlihat "kurang setor".
   * Halaman ini tak pernah mengambil terra sebelum vonis setoran disambungkan
   * (2026-08-09) — jadi menambahkannya bukan kelengkapan tampilan, melainkan
   * syarat kebenaran angkanya.
   */
  terra: { rp: number }[];
  /**
   * Baris manual hari TETANGGA (D−1 & D+1) — bahan aturan salin-setoran DUA
   * ARAH. `adminStatus` sendiri yang mengabaikan D+1 bila ia kebetulan hari
   * ini; berkas ini tak boleh ikut menyimpan aturan itu.
   */
  tetanggaSebelum: { f: Manual[]; g: Manual[]; i: Manual[] };
  tetanggaSesudah: { f: Manual[]; g: Manual[]; i: Manual[] };
}

/**
 * Sub-baris rekonsiliasi baris ⚠ DO Harian (SATU sumber utk layar & PDF).
 * KOMPAK — sel tabel memakai white-space:nowrap (pola sub-baris macet); kalimat
 * panjang meledakkan lebar min-content kolom (insiden layout 2026-07-13).
 * Penjelasan penuh (identitas Sisa = DO Awal + Penebusan − Penerimaan +
 * tak-terserap) ada di tooltip ⚠ dan footnote. null = tak dirender.
 */
export function alurSelisihNote(alurSelisih: number): string | null {
  if (alurSelisih > 0)
    return `${fmtL(alurSelisih)} tak terserap · lihat panel Alokasi`;
  if (alurSelisih < 0)
    return `${fmtL(-alurSelisih)} terserap lebih-terima lama · lihat panel Alokasi`;
  return null;
}

/**
 * Vonis Ketaatan Administrasi → cek alarm "Setoran Bank Sesuai".
 *
 * SATU pembuat vonis tetap `adminStatus` — fungsi ini hanya MENERJEMAHKAN, tidak
 * memutuskan. Ia diekspor supaya bisa diukur pada data hidup sebelum disambungkan
 * (dan supaya lolosnya tes menjamin jalur produksi, bukan salinan).
 *
 * `na` untuk SEMUA vonis bernada `pending`: hari berjalan, penjualan tak lengkap,
 * belum jatuh tempo, pra-adopsi. Sengaja BUKAN `provisional` — `provisional`
 * membuat nada skor jadi `warning`, dan hari yang memang belum bisa dinilai tak
 * boleh terlihat seperti kabar buruk. Itu kesalahan kanal dua-nilai yang sama
 * dengan `note.tone` di Rincian (lihat rincian-model.ts).
 *
 * `config_hilang` juga `na`, BUKAN `fail`: di papan Ketaatan ia merah karena di
 * sana ia satu-satunya suara untuk "indikator unit ini tak bisa dipercaya". Di
 * sini menjadikannya `fail` akan menuduh pengawas atas config yang belum diisi.
 * Catatannya yang menyuarakan, dan ia tetap di luar penyebut.
 */
export function setoranCheck(v: AdminVerdict, h: number, i: number | null): AlarmCheck {
  const selisih = i === null ? null : Math.abs(i - h);
  switch (v.kode) {
    case "selaras":
      return {
        label: "Setoran Bank Sesuai",
        state: "ok",
        note: `selaras dengan uang tunai (±${fmtRp(SETORAN_TOLERANSI_RP)})`,
      };
    case "setoran_tersalin":
      return {
        label: "Setoran Bank — SAMA PERSIS dengan hari tetangga",
        state: "fail",
        note:
          `${fmtRp(i ?? 0)} identik dengan hari sebelumnya/sesudahnya dan meleset ${fmtRp(selisih ?? 0)} dari uang tunai` +
          (v.komponenIkut ? " · Pendapatan Lain & Pengeluaran juga identik" : ""),
      };
    case "lebih_setor":
      return {
        label: "Setoran Bank melebihi uang tunai",
        state: "fail",
        note: `lebih ${fmtRp(selisih ?? 0)} di atas toleransi ${fmtRp(SETORAN_TOLERANSI_RP)}`,
      };
    case "kurang_setor":
      return {
        label: "Setoran Bank kurang dari uang tunai",
        state: "fail",
        note: `kurang ${fmtRp(selisih ?? 0)} di bawah toleransi ${fmtRp(SETORAN_TOLERANSI_RP)}`,
      };
    case "setoran_kosong":
      return {
        label: "Setoran Bank belum diisi",
        state: "fail",
        note: `pendapatan/pengeluaran terisi tapi setoran nihil · uang tunai ${fmtRp(h)} tak terpertanggungjawabkan`,
      };
    case "belum_diisi":
      return {
        label: "Setoran Bank belum diisi",
        state: "fail",
        note: "Rincian Penjualan belum diisi sama sekali · lewat jatuh tempo (akhir H+1)",
      };
    case "hari_berjalan":
      return {
        label: "Setoran Bank Sesuai",
        state: "na",
        note: "hari berjalan · uang tunai masih dirakit",
      };
    case "tak_terhitung":
      return {
        label: "Setoran Bank Sesuai",
        state: "na",
        note: "penjualan hari itu tak pernah lengkap · setoran tak bisa dinilai",
      };
    case "belum_tempo_terisi":
      return { label: "Setoran Bank Sesuai", state: "na", note: "sudah diisi · belum jatuh tempo" };
    case "belum_tempo_kosong":
      return {
        label: "Setoran Bank Sesuai",
        state: "na",
        note: "belum diisi · belum jatuh tempo (akhir H+1)",
      };
    case "pra_adopsi":
      return {
        label: "Setoran Bank Sesuai",
        state: "na",
        note: "sebelum unit ini memakai panel Rincian",
      };
    case "belum_adopsi":
      return {
        label: "Setoran Bank Sesuai",
        state: "na",
        note: "unit ini belum memakai panel Rincian sama sekali",
      };
    case "config_hilang":
      return {
        label: "Setoran Bank Sesuai",
        state: "na",
        note: "unit belum terdaftar di ADOPSI_RINCIAN (config) · indikator tak bisa dipercaya untuk unit ini",
      };
  }
}

/** Baris manual satu hari tetangga → bentuk yang dipakai aturan. */
function sisiTetangga(t: { f: Manual[]; g: Manual[]; i: Manual[] }): TetanggaHari {
  return {
    // null (bukan 0) bila tak ada baris: "tak ada setoran" bukan "setoran nol",
    // dan aturannya tak boleh menyala karena dua hari sama-sama kosong.
    i: t.i.length > 0 ? t.i.reduce((s, r) => s + r.amount, 0) : null,
    f: t.f.reduce((s, r) => s + r.amount, 0),
    g: t.g.reduce((s, r) => s + r.amount, 0),
  };
}

const orderBy = <T extends { nama: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => (classifyProduct(a.nama)?.order ?? 9) - (classifyProduct(b.nama)?.order ?? 9));

export function buildLaporanModel(
  raw: LaporanRaw,
  ctx: { unitCode: string; date: string; today: string; mi: MonthCtx; detail: boolean },
): LaporanModel {
  const { unitCode, date, today, mi, detail } = ctx;
  const {
    prodDay,
    glRows,
    prodMonth,
    delivMonth,
    doDay,
    doAnomalies,
    doSuspects,
    shift,
    cash,
    saldo,
  } = raw;

  // ── DO Harian (6 produk tetap) ──
  const doRows: DoHarianRow[] = DO_PRODUCTS.map((dp) => {
    const r = doDay.find((x) => resolveDoProduct(x.nama)?.key === dp.key);
    const doAwal = r?.do_awal ?? 0;
    const penerimaan = r?.penerimaan ?? 0;
    const penebusan = r?.penebusan ?? 0;
    const sisa = r?.sisa ?? 0;
    const sisaMacet = r?.sisa_macet ?? 0;
    return {
      key: dp.key,
      label: dp.label,
      doAwal,
      penerimaan,
      penebusan,
      sisa,
      sisaMacet,
      sisaBerjalan: sisa - sisaMacet,
      recon: Math.round(doAwal + penebusan - penerimaan - sisa),
      alurSelisih: Math.round(r?.alur_selisih ?? 0),
    };
  });
  const doTotals = doRows.reduce(
    (a, r) => ({
      doAwal: a.doAwal + r.doAwal,
      penerimaan: a.penerimaan + r.penerimaan,
      penebusan: a.penebusan + r.penebusan,
      sisa: a.sisa + r.sisa,
      sisaMacet: a.sisaMacet + r.sisaMacet,
    }),
    { doAwal: 0, penerimaan: 0, penebusan: 0, sisa: 0, sisaMacet: 0 },
  );
  // Suspects: daftar-kerja = produk AKTIF saja; nonaktif (mis. PREMIUM) diringkas
  // satu baris agar tak menenggelamkan yang bisa ditindak (LIMIT 50 di query).
  const suspectsAktif = doSuspects.filter((s) => s.aktif);
  const suspectsNonaktif = doSuspects
    .filter((s) => !s.aktif)
    .reduce(
      (a, s) => ({ count: a.count + 1, liters: a.liters + s.outstanding }),
      { count: 0, liters: 0 },
    );
  const anomRows = orderBy(
    doAnomalies.map((a) => ({ ...a, label: resolveDoProduct(a.nama)?.label ?? a.nama })),
  );

  // ── Omset / G/L (RESUME) / Tera ──
  const totSales = prodDay.reduce((s, p) => s + p.vol, 0);
  const totOmzet = prodDay.reduce((s, p) => s + p.omzet, 0);
  const dayAgg = aggregateDailyGl(glRows.filter((r) => r.d === date));
  const monthAgg = aggregateDailyGl(glRows);
  const glByCode = new Map([...dayAgg.byProduct].map(([k, v]) => [k, v.signed] as const));
  const teraByCode = new Map([...dayAgg.byProduct].map(([k, v]) => [k, v.tera] as const));
  const glTotal = dayAgg.totalSigned;
  const totTera = dayAgg.totalTera;
  const glPctDay = dayAgg.hasGl ? glPercent(glTotal, totSales) : null;
  const glProvisional = dayAgg.provisional;
  const glGarbageCount = dayAgg.excludedTanks;

  const salesRows: SalesRow[] = orderBy(prodDay).map((p) => ({
    ckdbbm: p.ckdbbm,
    nama: p.nama,
    vol: p.vol,
    gl: glByCode.get(p.ckdbbm) ?? null,
    tera: teraByCode.get(p.ckdbbm) ?? 0,
    omzet: p.omzet,
  }));

  const volMonth = prodMonth.reduce((s, p) => s + p.vol, 0);
  const glMonthTotal = monthAgg.totalSigned;
  const glPctMonth = monthAgg.hasGl ? glPercent(glMonthTotal, volMonth) : null;

  const isToday = date === today;
  const isPartial = isToday && shift.shifts < 3;
  const gasMix = bauran(prodDay, "gasoline");
  const oilMix = bauran(prodDay, "gasoil");

  // ── Alarm (3 aktif, 8 menunggu data) ──
  const targetGap = prodMonth.map((p) => {
    const perDay = targetVolumePerDay(unitCode, mi.month, p.nama);
    return perDay !== null ? p.vol - perDay * mi.dayOfMonth : null;
  });
  const worstGap = targetGap.filter((x): x is number => x !== null).sort((a, b) => a - b)[0];
  const hasTarget = targetGap.some((x) => x !== null);

  const na = (label: string, domain: string): AlarmCheck => ({
    label,
    state: "na",
    note: `belum tersedia · ${domain}`,
  });

  const dailyLoss = (): AlarmCheck => {
    if (glPctDay === null)
      return {
        label: "Losses harian — menunggu opname",
        state: "na",
        note: "opname penutup belum ada",
      };
    if (glProvisional)
      return {
        label: "Losses harian — sementara",
        state: "provisional",
        note: `${signed(glTotal)} L berjalan · belum final, menunggu opname penutup${glGarbageCount > 0 ? ` · ${glGarbageCount} baris dikecualikan` : ""}`,
      };
    const within = Math.abs(glTotal) <= 100 && Math.abs(glPctDay) <= 0.005;
    return {
      label: within ? "Losses harian aman" : "Losses harian di atas ambang",
      state: within ? "ok" : "fail",
      note: `${signed(glTotal)} L · ${pct(Math.abs(glPctDay), 2)}${glGarbageCount > 0 ? ` · ${glGarbageCount} baris dikecualikan` : ""}`,
    };
  };

  const monthlyWithin = glPctMonth === null || Math.abs(glPctMonth) <= 0.005;
  const monthlyLoss: AlarmCheck = {
    label: monthlyWithin ? "Losses bulanan aman" : "Losses bulanan di atas ambang",
    state: monthlyWithin ? "ok" : "fail",
    note: glPctMonth !== null ? `${signed(glMonthTotal)} L · ${pct(Math.abs(glPctMonth), 2)}` : "—",
  };

  const targetCheck = (): AlarmCheck => {
    if (!hasTarget)
      return {
        label: "Target bulan ini — belum diisi",
        state: "na",
        note: "target bulan ini belum diisi",
      };
    const met = (worstGap ?? 0) >= 0;
    return {
      label: met ? "Target bulan ini tercapai" : "Target bulan ini di bawah prorata",
      state: met ? "ok" : "fail",
      note:
        worstGap !== undefined && worstGap < 0 ? `${parenNeg(worstGap)} vs prorata` : "sesuai prorata",
    };
  };

  // ── Setoran Bank Sesuai — VONIS TUNGGAL `adminStatus` (2026-08-09) ────────
  // Komponen A–G dari raw halaman ini; H dari lib/rekon.ts. TIDAK ada rumus H
  // kedua di berkas ini — kalau ada yang menuliskannya lagi di sini, hapus.
  const setoranI =
    raw.recapSetoran.length > 0 ? raw.recapSetoran.reduce((t, r) => t + r.amount, 0) : null;
  const H = uangTunai({
    A: prodDay.reduce((t, p) => t + p.omzet, 0),
    B: raw.terra.reduce((t, r) => t + r.rp, 0),
    C: raw.recapPelanggan.reduce((t, r) => t + r.rp, 0),
    D: raw.recapEdc.reduce((t, r) => t + r.rp, 0),
    F: raw.recapPendapatanLain.reduce((t, r) => t + r.amount, 0),
    G: raw.recapPengeluaran.reduce((t, r) => t + r.amount, 0),
  });
  const setoranVerdict = adminStatus(
    {
      adopsi: adopsiRincian(unitCode),
      nPendapatanLain: raw.recapPendapatanLain.length,
      nPengeluaran: raw.recapPengeluaran.length,
      nSetoran: raw.recapSetoran.length,
      h: H,
      i: setoranI,
      f: raw.recapPendapatanLain.reduce((t, r) => t + r.amount, 0),
      g: raw.recapPengeluaran.reduce((t, r) => t + r.amount, 0),
      tetangga: { sebelum: sisiTetangga(raw.tetanggaSebelum), sesudah: sisiTetangga(raw.tetanggaSesudah) },
      shifts: shift.shifts,
    },
    { businessDate: date, today },
  );

  const checks: AlarmCheck[] = [
    dailyLoss(),
    monthlyLoss,
    setoranCheck(setoranVerdict, H, setoranI),
    targetCheck(),
    na("Pencatatan DO Sesuai", "Domain DO"),
    /**
     * "Pengeluaran Sudah Disahkan" SENGAJA tetap `na` (keputusan 2026-08-09).
     *
     * Yang kita punya di `app.manual_entry` hanyalah bahwa baris pengeluaran
     * ADA dan berapa nilainya. **Disahkan** adalah pertanyaan lain: siapa yang
     * menyetujui, kapan, atas dasar apa. Tak ada satu pun kolom yang menyimpan
     * itu — tak ada approver, tak ada stempel waktu persetujuan, tak ada status.
     *
     * Menyambungkannya ke "ada barisnya" akan membuat cek ini HIJAU untuk
     * pengeluaran yang tak pernah disahkan siapa pun — hijau palsu yang lebih
     * buruk daripada `na` jujur, karena ia menutup pertanyaannya.
     *
     * Membukanya butuh kolom persetujuan + panel pengesahan (belum ada gerbang
     * ownernya). Sampai itu ada, catatannya yang bicara.
     */
    na("Pengeluaran Sudah Disahkan", "belum ada data pengesahan — bukan sekadar belum tersambung"),
    na("Harga Beli/Jual Benar", "master harga beli"),
    na("Saldo Hutang/Piutang Pelanggan Sesuai", "Domain deposit"),
    na("DO Untuk Penerimaan Besok Cukup", "Domain DO"),
    na("Permintaan Besok Sudah Cukup", "Domain DO"),
    na("Settlement EDC Sudah Sesuai", "Domain EDC"),
  ];
  const score = alarmScore(checks);
  const scoreTone: Tone =
    score.fail >= 2 ? "danger" : score.fail === 1 ? "warning" : score.provisional > 0 ? "warning" : "success";

  const cashTotal = cash.filter((c) => !c.sbatal).reduce((s, c) => s + (c.ntotal ?? 0), 0);

  // ── Recap harian + Saldo ──
  const recapBoxes = [
    {
      label: "Transaksi Pelanggan",
      val: raw.recapPelanggan.reduce((s, r) => s + r.rp, 0),
      note: "penjualan tempo (RFID/voucher)",
    },
    {
      label: "Pengeluaran",
      val: raw.recapPengeluaran.reduce((s, r) => s + r.amount, 0),
      note: "input pengawas",
    },
    { label: "EDC", val: raw.recapEdc.reduce((s, r) => s + r.rp, 0), note: "non-tunai per channel" },
    {
      label: "Pendapatan Lain",
      val: raw.recapPendapatanLain.reduce((s, r) => s + r.amount, 0),
      note: "input pengawas",
    },
    { label: "Transfer", val: raw.recapDeposit.reduce((s, r) => s + r.rp, 0), note: "deposit / non-tunai" },
    {
      label: "Setoran Bank",
      val: raw.recapSetoran.reduce((s, r) => s + r.amount, 0),
      note: "disetor ke bank (pengawas)",
    },
  ];
  // Dua batas berdampingan: EasyMax "Laporan Penjualan Harian" memakai saldo AWAL
  // hari, "Daftar Saldo Hutang Piutang" memakai saldo AKHIR hari. Keduanya sah —
  // pengawas mencocokkan ke laporan yang kebetulan ia pegang.
  const saldoRows = [
    {
      label: "Saldo Piutang Pelanggan Lokal",
      awal: saldo.awal.piutangLokal,
      akhir: saldo.akhir.piutangLokal,
    },
    {
      label: "Saldo Piutang Pelanggan Online",
      awal: saldo.awal.piutangOnline,
      akhir: saldo.akhir.piutangOnline,
    },
    {
      label: "Saldo Hutang Pelanggan Lokal",
      awal: saldo.awal.hutangLokal,
      akhir: saldo.akhir.hutangLokal,
      danger: true,
    },
  ];
  const hasSaldo = saldoRows.some((r) => r.awal !== 0 || r.akhir !== 0);
  const hasRecap = hasSaldo || recapBoxes.some((b) => b.val !== 0);

  // ── G/L kumulatif bulanan (rows) ──
  const glMonthRows: GlMonthRow[] = orderBy(
    [...monthAgg.byProduct].map(([ckdbbm, v]) => ({
      ckdbbm,
      nama: v.nama ?? ckdbbm,
      selisih: v.signed,
      vol: prodMonth.find((p) => p.ckdbbm === ckdbbm)?.vol ?? 0,
    })),
  );

  // ── Realisasi & Target (rows) ──
  const targetRows: TargetRow[] = orderBy(prodMonth).map((p) => {
    const perDay = targetVolumePerDay(unitCode, mi.month, p.nama);
    const alok = perDay !== null ? perDay * mi.daysInMonth : null;
    const sel = perDay !== null ? p.vol - perDay * mi.dayOfMonth : null;
    const terima =
      delivMonth.find((d) => canonicalProductKey(d.nama) === canonicalProductKey(p.nama))?.vol ?? 0;
    return {
      ckdbbm: p.ckdbbm,
      nama: p.nama,
      vol: p.vol,
      avgPerDay: p.vol / mi.dayOfMonth,
      terima,
      alok,
      sel,
    };
  });

  // ── Harga (rows) ──
  const hargaRows: HargaRow[] = orderBy(prodDay).map((p) => ({
    ckdbbm: p.ckdbbm,
    nama: p.nama,
    harga: p.harga,
  }));

  // ── Rekonsiliasi A–I ──
  const rekonRows: RekonRow[] = [
    { l: "A", label: "Omset Penjualan", val: totOmzet, op: "" },
    { l: "B", label: "Tera / Nozzle Test", val: null, op: "−" },
    { l: "C", label: "Pelanggan (piutang)", val: null, op: "−" },
    { l: "D", label: "EDC", val: null, op: "−" },
    { l: "E", label: "Penjualan Tunai", val: null, em: true, formula: "E = A − (B + C + D)" },
    { l: "F", label: "Pendapatan Lain", val: null, op: "+" },
    { l: "G", label: "Pengeluaran", val: cash.length > 0 ? cashTotal : null, op: "−" },
    { l: "H", label: "Uang Tunai", val: null, em: true, formula: "H = E + F − G" },
    { l: "I", label: "Setoran Bank", val: null, em: true },
  ];

  return {
    detail,
    header: {
      isPartial,
      shifts: shift.shifts,
      lastDtgljam: shift.last_dtgljam,
      scoreText: score.text,
      scoreTone,
      provisionalCount: score.provisional,
      fail: score.fail,
      omzetTotal: totOmzet,
    },
    checks,
    sales: {
      rows: salesRows,
      totVol: totSales,
      totOmzet,
      glTotal,
      totTera,
      glPctDay,
      glProvisional,
      glGarbageCount,
      gasMix,
      oilMix,
    },
    recap: { hasRecap, hasSaldo, saldoRows, recapBoxes },
    glMonthly: { rows: glMonthRows, glMonthTotal, glPctMonth },
    target: { rows: targetRows },
    doHarian: {
      rows: doRows,
      totals: doTotals,
      suspects: suspectsAktif,
      suspectsNonaktif,
      anomRows,
    },
    harga: { rows: hargaRows },
    rekon: { rows: rekonRows, cashTotal },
    corrections: raw.corrections,
  };
}
