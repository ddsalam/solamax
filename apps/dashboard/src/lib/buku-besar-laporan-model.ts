import { POS } from "./buku-besar-model";
import { posKasBank, rpSen } from "./buku-besar-memorial-model";
import type { JenisPos, Pos } from "./pos-model";

/**
 * Neraca dan laba-rugi FORMAL per unit per bulan — MURNI (rencana 2026-11-02
 * K6 U9; R10, R12, KTD10). Pembacanya `buku-besar-queries.ts`.
 *
 * ⛔ YANG MENGIKAT:
 *
 * 1. **Dibaca dari jurnal tersimpan, bukan snapshot** (KTD10). Hanya jurnal
 *    `aktif`; memorial `menunggu` tidak masuk laporan sampai disetujui (R8),
 *    yang `batal` tidak pernah.
 * 2. **Saldo awal dari `saldo_awal_pos`**, bukan jurnal berjenis `saldo_awal` —
 *    keduanya tak boleh dijumlah (sama dengan `SQL_SALDO_SEBELUM`, U8).
 * 3. **Saldo menurut tanggal efektif** (R33): jurnal koreksi yang terdorong
 *    maju dihitung di bulan asalnya. Pembaca yang memilih barisnya.
 * 4. **3900 Laba Tahun Berjalan dihitung**, tidak dijurnal: −Σ saldo kelas 4
 *    dan 5 sejak buku besar dimulai. Pemindahan ke 3200 di akhir tahun belum
 *    dibangun (spec-flow M3).
 * 5. **Beda tidak disembunyikan.** Neraca yang tidak seimbang (mustahil bila DB
 *    menegakkan seimbang per jurnal) tampil dengan bedanya.
 * 6. **Laporan bertanda "sementara"** (R10) sampai saldo awal lengkap DAN bulan
 *    itu ditutup dengan buku besar. Setiap sebab dinamai.
 */

/** Gerak pos teragregasi, satu baris per (pos, status, jenis, di bulan ini?). */
export interface GerakPos {
  posKode: string;
  status: "aktif" | "menunggu" | "batal";
  jenis: "sumber" | "koreksi" | "memorial" | "saldo_awal";
  /** `true` = tanggal efektif di bulan laporan; `false` = sebelum bulan itu. */
  dalamBulan: boolean;
  debetSen: number;
  kreditSen: number;
}

export interface KasPembuka {
  nama: string;
  /** Pos rekening ini (1101, 1102, 111x); `null` = rekening bank tanpa sub-pos. */
  posKode: string | null;
  /** Saldo pembuka bertanda (§10.24); `null` = belum ditetapkan. */
  saldoSen: number | null;
  sementara: boolean;
}

export interface BahanLaporanBukuBesar {
  daftar: readonly Pos[];
  /** `saldo_awal_pos` yang berlaku (non-void). */
  saldoAwal: readonly { posKode: string; saldoSen: number; sumber: "akuntan" | "akun_kas" }[];
  /** Saldo pembuka rekening SAAT INI (baris `cash_ledger.saldo_awal`). */
  kasPembuka: readonly KasPembuka[];
  /** Jurnal bertanggal efektif ≤ akhir bulan laporan. */
  gerak: readonly GerakPos[];
  bulanDitutupBukuBesar: boolean;
}

export interface BarisPos {
  kode: string;
  nama: string;
  kodeInduk: string | null;
  /** Di sisi normal kelompoknya (aset/beban: debet; kewajiban/modal/pendapatan: kredit). */
  nilaiSen: number;
}

export interface KelompokNeraca {
  jenis: Extract<JenisPos, "aset" | "kewajiban" | "modal">;
  judul: string;
  baris: BarisPos[];
  totalSen: number;
}

export interface LaporanBukuBesar {
  neraca: {
    kelompok: KelompokNeraca[];
    labaBerjalanSen: number;
    totalAsetSen: number;
    totalKewajibanModalSen: number;
    /** Aset − (kewajiban + modal + laba berjalan). 0 = seimbang. */
    bedaSen: number;
  };
  labaRugi: {
    pendapatan: BarisPos[];
    beban: BarisPos[];
    totalPendapatanSen: number;
    totalBebanSen: number;
    labaSen: number;
  };
  /** Saldo bertanda (debet +) per pos pada akhir bulan — untuk pembanding. */
  saldoAkhir: ReadonlyMap<string, number>;
  saldoAwalLengkap: boolean;
  /** Sebab laporan bertanda "sementara". Kosong = final. */
  sementara: string[];
}

const JUDUL: Record<KelompokNeraca["jenis"], string> = { aset: "Aset", kewajiban: "Kewajiban", modal: "Modal" };

function jenisDari(kode: string, daftar: readonly Pos[]): JenisPos {
  const p = daftar.find((x) => x.kode === kode);
  if (p) return p.jenis;
  return (["aset", "kewajiban", "modal", "pendapatan", "beban"] as const)[Number(kode[0]) - 1] ?? "aset";
}

/** Sebab saldo awal belum lengkap. Kosong = lengkap. */
export function sebabSaldoAwalBelumLengkap(b: Pick<BahanLaporanBukuBesar, "saldoAwal" | "kasPembuka" | "daftar">): string[] {
  const out: string[] = [];
  if (b.saldoAwal.length === 0) {
    out.push("Saldo awal per 30 Sep 2026 belum diisi.");
  } else {
    const beda = b.saldoAwal.reduce((s, x) => s + x.saldoSen, 0);
    if (beda !== 0) out.push(`Saldo awal tersimpan tidak seimbang (beda ${rpSen(Math.abs(beda))}).`);
  }
  for (const k of b.kasPembuka) {
    if (k.saldoSen === null) out.push(`Saldo pembuka rekening ${k.nama} belum ditetapkan.`);
    else if (k.sementara) out.push(`Saldo pembuka rekening ${k.nama} masih sementara.`);
    if (k.posKode === null) out.push(`Rekening ${k.nama} belum punya sub-pos bank.`);
  }
  if (b.saldoAwal.length > 0) {
    // Saldo pembuka rekening yang diganti sesudah saldo awal pos disimpan
    // membuat salinan `akun_kas` usang — neraca membaca salinan itu.
    const kini = new Map<string, number>();
    for (const k of b.kasPembuka) if (k.posKode !== null && k.saldoSen !== null) kini.set(k.posKode, (kini.get(k.posKode) ?? 0) + k.saldoSen);
    const tersimpan = new Map<string, number>();
    for (const s of b.saldoAwal) if (s.sumber === "akun_kas") tersimpan.set(s.posKode, (tersimpan.get(s.posKode) ?? 0) + s.saldoSen);
    const kode = new Set([...kini.keys(), ...tersimpan.keys()]);
    if ([...kode].some((k) => (kini.get(k) ?? 0) !== (tersimpan.get(k) ?? 0))) {
      out.push("Saldo pembuka rekening berubah sesudah saldo awal pos disimpan — simpan ulang Saldo awal.");
    }
  }
  return out;
}

export function susunLaporan(b: BahanLaporanBukuBesar): LaporanBukuBesar {
  const saldo = new Map<string, number>();
  const tambah = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const s of b.saldoAwal) tambah(saldo, s.posKode, s.saldoSen);
  const bulanIni = new Map<string, number>();
  for (const x of b.gerak) {
    if (x.status !== "aktif" || x.jenis === "saldo_awal") continue;
    tambah(saldo, x.posKode, x.debetSen - x.kreditSen);
    if (x.dalamBulan) tambah(bulanIni, x.posKode, x.debetSen - x.kreditSen);
  }

  const posDari = (kode: string) => b.daftar.find((p) => p.kode === kode);
  const baris = (m: Map<string, number>, jenis: JenisPos): BarisPos[] =>
    [...m.entries()]
      .filter(([k, v]) => v !== 0 && jenisDari(k, b.daftar) === jenis)
      .sort(([a], [c]) => a.localeCompare(c))
      .map(([k, v]) => {
        const p = posDari(k);
        const debetNormal = jenis === "aset" || jenis === "beban";
        return { kode: k, nama: p?.nama ?? `Pos ${k}`, kodeInduk: p?.kodeInduk ?? null, nilaiSen: debetNormal ? v : -v };
      });
  const jumlah = (xs: readonly BarisPos[]) => xs.reduce((s, x) => s + x.nilaiSen, 0);

  const kelompok: KelompokNeraca[] = (["aset", "kewajiban", "modal"] as const).map((jenis) => {
    const bs = baris(saldo, jenis);
    return { jenis, judul: JUDUL[jenis], baris: bs, totalSen: jumlah(bs) };
  });
  const labaBerjalan = -[...saldo.entries()]
    .filter(([k]) => ["pendapatan", "beban"].includes(jenisDari(k, b.daftar)))
    .reduce((s, [, v]) => s + v, 0);
  const totalAset = kelompok[0]!.totalSen;
  const totalKewajibanModal = kelompok[1]!.totalSen + kelompok[2]!.totalSen + labaBerjalan;

  const pendapatan = baris(bulanIni, "pendapatan");
  const beban = baris(bulanIni, "beban");
  const totalPendapatan = jumlah(pendapatan);
  const totalBeban = jumlah(beban);

  const sebabAwal = sebabSaldoAwalBelumLengkap(b);
  const sementara = [...sebabAwal];
  if (!b.bulanDitutupBukuBesar) sementara.push("Bulan ini belum ditutup dengan buku besar.");

  return {
    neraca: {
      kelompok,
      labaBerjalanSen: labaBerjalan,
      totalAsetSen: totalAset,
      totalKewajibanModalSen: totalKewajibanModal,
      bedaSen: totalAset - totalKewajibanModal,
    },
    labaRugi: {
      pendapatan,
      beban,
      totalPendapatanSen: totalPendapatan,
      totalBebanSen: totalBeban,
      labaSen: totalPendapatan - totalBeban,
    },
    saldoAkhir: saldo,
    saldoAwalLengkap: sebabAwal.length === 0,
    sementara,
  };
}

// ---------------------------------------------------------------------------
// Pembanding laporan rumus (R12)
// ---------------------------------------------------------------------------

/** Angka laporan rumus yang sebanding, dalam RUPIAH. `null` = tak terhitung. */
export interface AngkaRumus {
  /** Cash on hand akhir bulan — semua rekening kas, EDC Penampungan, dan bank. */
  kasBankRp: number | null;
  /** Nilai stock akhir bulan (stok × harga beli). */
  persediaanRp: number | null;
  /** Nilai DO / sisa SO akhir bulan. */
  soRp: number | null;
  /** Piutang pelanggan EasyMax akhir bulan. */
  piutangEasymaxRp: number | null;
  /** Σ net profit harian di bulan itu. */
  labaRp: number | null;
}

export interface BarisTemuan {
  kunci: "kas_bank" | "persediaan" | "so" | "piutang" | "laba";
  label: string;
  /** Pos buku besar yang dijumlah. */
  pos: string[];
  bukuBesarSen: number;
  rumusSen: number | null;
  /** Buku besar − rumus. `null` = rumus tak terhitung. */
  bedaSen: number | null;
  temuan: boolean;
}

/** Rupiah (bisa desimal) → sen, dibulatkan sekali. */
const senDari = (rp: number | null): number | null => (rp === null ? null : Math.round(rp * 100));

export function temuanBeda(l: LaporanBukuBesar, r: AngkaRumus, daftar: readonly Pos[] = []): BarisTemuan[] {
  const saldoPos = (pred: (kode: string) => boolean) =>
    [...l.saldoAkhir.entries()].filter(([k]) => pred(k)).reduce((s, [, v]) => s + v, 0);
  const kasBank = (kode: string) => {
    const p = daftar.find((x) => x.kode === kode);
    return p ? posKasBank(p) : kode === POS.KAS_BESAR || kode === POS.EDC_PENAMPUNGAN || /^111[1-9]$/.test(kode);
  };
  const kasPos = [...l.saldoAkhir.keys()].filter(kasBank).sort();
  const baris = (kunci: BarisTemuan["kunci"], label: string, pos: string[], bukuBesarSen: number, rumusRp: number | null): BarisTemuan => {
    const rumusSen = senDari(rumusRp);
    const bedaSen = rumusSen === null ? null : bukuBesarSen - rumusSen;
    return { kunci, label, pos, bukuBesarSen, rumusSen, bedaSen, temuan: bedaSen !== null && bedaSen !== 0 };
  };
  return [
    baris("kas_bank", "Kas dan bank", kasPos.length ? kasPos : ["1101", "1102", "111x"], saldoPos(kasBank), r.kasBankRp),
    baris("persediaan", "Persediaan BBM di tangki", [POS.PERSEDIAAN_TANGKI], saldoPos((k) => k === POS.PERSEDIAAN_TANGKI), r.persediaanRp),
    baris("so", "SO sudah dibayar (sisa SO)", [POS.SO_DIBAYAR], saldoPos((k) => k === POS.SO_DIBAYAR), r.soRp),
    baris("piutang", "Piutang pelanggan EasyMax", [POS.PIUTANG_EASYMAX], saldoPos((k) => k === POS.PIUTANG_EASYMAX), r.piutangEasymaxRp),
    baris("laba", "Laba bersih bulan ini", ["4xxx", "5xxx"], l.labaRugi.labaSen, r.labaRp),
  ];
}

