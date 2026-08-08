/**
 * Model data Rincian Penjualan — SUMBER TUNGGAL untuk render layar (HTML) DAN
 * ekspor PDF (pdfmake). Dibangun dari hasil query yang SUDAH ber-scope
 * (ScopedUnitId) di server; fungsi ini murni (tanpa I/O) → angka PDF identik
 * dengan angka layar (rekon ke rupiah). Formatter id-ID/WIB dari lib/format.
 */
import { adminStatus, SETORAN_TOLERANSI_RP, type AdminVerdict } from "@/lib/compliance";
import { classifyProduct } from "@/lib/config";
import { idn, rp } from "@/lib/format";
import type * as Q from "@/lib/queries";
import { penjualanTunai, uangTunai } from "@/lib/rekon";

type ProdRow = Awaited<ReturnType<typeof Q.getSalesByProduct>>[number];
type TerraRow = Awaited<ReturnType<typeof Q.getTerraResmiForDate>>[number];
type PelRow = Awaited<ReturnType<typeof Q.getPelangganForDate>>[number];
type EdcRow = Awaited<ReturnType<typeof Q.getEdcForDate>>[number];
type EdcBlank = Awaited<ReturnType<typeof Q.getEdcBlankCard>>;
type DepRow = Awaited<ReturnType<typeof Q.getDepositForDate>>[number];
type ManualRow = Awaited<ReturnType<typeof Q.getManualEntries>>[number];

export interface LedgerRow {
  no: string;
  ket: string;
  vol: string;
  rpv: string;
}

export interface Section {
  num: string;
  title: string;
  meta: string;
  rows: LedgerRow[];
  totalLabel: string;
  totalVol: string;
  totalRp: string | null;
}

export interface SummaryRow {
  l: string;
  label: string;
  formula?: string;
  val: string | null;
  em?: boolean;
  /**
   * `info` = NETRAL (bukan kabar buruk). Ditambahkan 2026-08-08: kanalnya dulu
   * hanya `ok | warn`, dan SETIAP non-ok dirender merah-danger + titik merah +
   * glyph ⚠ — di layar DAN di PDF bertanda tangan. Jadi catatan yang berbunyi
   * "belum bisa dinilai" tampil dengan tiga penanda yang semuanya berkata
   * "masalah". Kanal dua-nilai dipaksa membawa fakta tiga-nilai.
   */
  note?: { tone: "ok" | "warn" | "info"; text: string };
}

export interface RincianModel {
  /** Ke-7 section (termasuk yang kosong) — konsumen memfilter sesuai kebutuhan. */
  sections: Section[];
  summary: SummaryRow[];
  /** Vonis dari `adminStatus` — SATU pembuat vonis, dipakai bersama Ketaatan. */
  verdict: AdminVerdict;
}

/**
 * Konteks VONIS — wajib, bukan opsional.
 *
 * ⚠️ KENAPA ADA (2026-08-07): pagi ini kami menyatukan RUMUS H ke `lib/rekon.ts`
 * dan menyatakan "sumber tunggal tercapai". Yang berduplikat ternyata bukan
 * rumusnya melainkan VONISNYA: `adminStatus` mendapat gerbang `shifts <
 * SHIFT_TARGET`, sementara berkas ini menghitung verdict setorannya SENDIRI dan
 * tak pernah menerima `shifts`. Akibatnya halaman Ketaatan sembuh sementara
 * halaman Rincian — LEMBAR CETAK YANG DITANDATANGANI PENGAWAS — masih menulis
 * "⚠ Setoran MELEBIHI uang tunai (selisih Rp 89.189.622)" untuk Korek 2026-08-07
 * pada hari yang baru 2 dari 3 shift-nya masuk.
 *
 * Menyatukan INPUT tidak menyatukan KEPUTUSAN. Field ini WAJIB supaya membangun
 * model Rincian tanpa menyediakan fakta yang dibutuhkan untuk menilainya adalah
 * error type-check, bukan lubang senyap.
 */
export interface RincianKonteks {
  /** Shift penjualan ter-ingest hari itu (`getShiftInfo`). */
  shifts: number;
  /** Lantai adopsi unit (`adopsiRincian(code)`) — 3 nilai berbeda, lihat config. */
  adopsi: string | null | undefined;
  businessDate: string;
  today: string;
}

export interface RincianRaw {
  konteks: RincianKonteks;
  prod: ProdRow[];
  terra: TerraRow[];
  pelanggan: PelRow[];
  edc: EdcRow[];
  edcBlank: EdcBlank;
  deposit: DepRow[];
  pendapatanLain: ManualRow[];
  pengeluaran: ManualRow[];
  setoranTunai: ManualRow[];
}

/** Bangun model Rincian dari data mentah ber-scope. Murni & serializable. */
export function buildRincianModel(raw: RincianRaw): RincianModel {
  const { prod, terra, pelanggan, edc, edcBlank, deposit } = raw;
  const { pendapatanLain, pengeluaran, setoranTunai } = raw;

  const ordered = [...prod].sort(
    (a, b) => (classifyProduct(a.nama)?.order ?? 9) - (classifyProduct(b.nama)?.order ?? 9),
  );
  const totVol = prod.reduce((s, p) => s + p.vol, 0);
  // Summary A–I (rekon kas).
  const A = prod.reduce((s, p) => s + p.omzet, 0);
  const teraLiter = terra.reduce((s, r) => s + r.liter, 0);
  const B = terra.reduce((s, r) => s + r.rp, 0);
  const pelLiter = pelanggan.reduce((s, r) => s + r.liter, 0);
  const C = pelanggan.reduce((s, r) => s + r.rp, 0);
  const D = edc.reduce((s, r) => s + r.rp, 0);
  const depTotal = deposit.reduce((s, r) => s + r.rp, 0);
  const F = pendapatanLain.reduce((s, r) => s + r.amount, 0);
  const G = pengeluaran.reduce((s, r) => s + r.amount, 0);
  // E & H dari lib/rekon.ts — SUMBER TUNGGAL, dipakai bersama indikator Ketaatan
  // Administrasi. Jangan tulis ulang formulanya di sini.
  const E = penjualanTunai({ A, B, C, D }); // Penjualan Tunai
  const H = uangTunai({ A, B, C, D, F, G }); // Uang Tunai
  const I = setoranTunai.length > 0 ? setoranTunai.reduce((s, r) => s + r.amount, 0) : null;

  // VONIS TUNGGAL — `adminStatus`, aturan yang sama persis dengan halaman
  // Ketaatan dan feed anomali. Berkas ini TIDAK lagi memutuskan sendiri.
  const verdict = adminStatus(
    {
      adopsi: raw.konteks.adopsi,
      nPendapatanLain: pendapatanLain.length,
      nPengeluaran: pengeluaran.length,
      nSetoran: setoranTunai.length,
      h: H,
      i: I,
      shifts: raw.konteks.shifts,
    },
    { businessDate: raw.konteks.businessDate, today: raw.konteks.today },
  );

  const sections: Section[] = [
    {
      num: "1",
      title: "OMSET PENJUALAN",
      meta: "per produk · totalisator nozzle",
      rows: ordered.map((p, i) => ({
        no: String(i + 1),
        ket: p.nama,
        vol: idn(p.vol, 2),
        rpv: rp(p.omzet),
      })),
      totalLabel: "TOTAL OMSET PENJUALAN",
      totalVol: idn(totVol, 2),
      totalRp: rp(A),
    },
    {
      num: "2",
      title: "TERRA",
      meta: "tera resmi / nozzle test · dikurangkan dari Penjualan Tunai (B)",
      rows: terra.map((r, i) => ({
        no: String(i + 1),
        ket: r.nama ?? r.ckdbbm ?? "—",
        vol: idn(r.liter, 2),
        rpv: rp(r.rp),
      })),
      totalLabel: "TOTAL TERRA",
      totalVol: idn(teraLiter, 2),
      totalRp: rp(B),
    },
    {
      num: "3",
      title: "PELANGGAN",
      meta: "penjualan tempo (RFID/deposit ⊎ voucher)",
      rows: pelanggan.map((r, i) => ({
        no: String(i + 1),
        ket: r.nama ?? r.ckdplg ?? "—",
        vol: idn(r.liter, 2),
        rpv: rp(r.rp),
      })),
      totalLabel: "TOTAL PELANGGAN",
      totalVol: idn(pelLiter, 2),
      totalRp: rp(C),
    },
    {
      num: "4",
      title: "EDC",
      meta:
        edcBlank.rp > 0
          ? `channel non-tunai · ⚠ blank-card ${rp(edcBlank.rp)} (${edcBlank.n} txn, di luar total)`
          : "channel non-tunai",
      rows: edc.map((r, i) => ({
        no: String(i + 1),
        ket: r.nama,
        vol: "",
        rpv: rp(r.rp),
      })),
      totalLabel: "TOTAL EDC",
      totalVol: "",
      totalRp: rp(D),
    },
    {
      num: "5",
      title: "PENDAPATAN LAIN",
      meta: "input pengawas",
      rows: pendapatanLain.map((r, i) => ({
        no: String(i + 1),
        ket: r.keterangan,
        vol: "",
        rpv: rp(r.amount),
      })),
      totalLabel: "TOTAL PENDAPATAN LAIN",
      totalVol: "",
      totalRp: rp(F),
    },
    {
      num: "6",
      title: "PENDAPATAN NON TUNAI",
      meta: "deposit pelanggan · tidak masuk rekonsiliasi tunai",
      rows: deposit.map((r, i) => ({
        no: String(i + 1),
        ket: r.vcket ?? r.ckdplg ?? "—",
        vol: "",
        rpv: rp(r.rp),
      })),
      totalLabel: "TOTAL PENDAPATAN NON TUNAI",
      totalVol: "",
      totalRp: rp(depTotal),
    },
    {
      num: "7",
      title: "PENGELUARAN",
      meta: "input pengawas",
      rows: pengeluaran.map((r, i) => ({
        no: String(i + 1),
        ket: r.keterangan,
        vol: "",
        rpv: rp(r.amount),
      })),
      totalLabel: "TOTAL PENGELUARAN",
      totalVol: "",
      totalRp: rp(G),
    },
  ];

  const summary: SummaryRow[] = [
    { l: "A", label: "Omset Penjualan", val: rp(A) },
    { l: "B", label: "Terra / Nozzle Test", val: rp(B) },
    { l: "C", label: "Pelanggan", val: rp(C) },
    { l: "D", label: "EDC", val: rp(D) },
    { l: "E", label: "Penjualan Tunai", formula: "E = A − (B + C + D)", val: rp(E), em: true },
    { l: "F", label: "Pendapatan Lain", val: rp(F) },
    { l: "G", label: "Pengeluaran", val: rp(G) },
    { l: "H", label: "Uang Tunai", formula: "H = E + F − G", val: rp(H), em: true },
    {
      l: "I",
      label: "Setoran Tunai",
      val: I !== null ? rp(I) : null,
      em: true,
      // Catatan DITURUNKAN dari `verdict`, bukan dihitung ulang. Kalau vonisnya
      // bukan salah satu dari tiga kode setoran (mis. `tak_terhitung` karena H
      // masih dirakit), TIDAK ADA catatan yang muncul — persis seperti sel
      // Ketaatan yang jadi netral.
      note:
        I === null
          ? undefined
          : verdict.kode === "selaras"
            ? { tone: "ok", text: `Setoran selaras dengan uang tunai (±${rp(SETORAN_TOLERANSI_RP)})` }
            : verdict.kode === "lebih_setor"
              ? { tone: "warn", text: `Setoran MELEBIHI uang tunai (selisih ${rp(I - H)})` }
              : verdict.kode === "kurang_setor"
                ? { tone: "warn", text: `Setoran kurang dari uang tunai (selisih ${rp(H - I)})` }
                : verdict.kode === "tak_terhitung"
                  ? {
                      tone: "info",
                      text: "Penjualan hari ini belum lengkap — setoran belum dibandingkan dengan uang tunai",
                    }
                  : undefined,
    },
  ];

  return { sections, summary, verdict };
}
