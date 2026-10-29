import { hariDalamBulan } from "./bulan";
import { KODE_MAJU_REVERSAL } from "./keuangan-kode-maju";

/**
 * TUTUP BULAN — pembuat vonis MURNI (rencana 2026-10-29 U12; R25, AE5; KTD14).
 * Tanpa I/O: dipakai halaman tutup bulan (daftar periksa) DAN `tutupBulan`
 * (di bawah kuncinya). Pola `periksaTutupHari`: aturan diputuskan SATU tempat —
 * layar dan aksi yang menyalin syaratnya sendiri akan menjawab berbeda.
 *
 * Empat syarat yang tampil sebagai empat baris daftar periksa:
 *
 *   1. **hari**       — setiap hari kalender bulan itu `day_close.status =
 *                       'closed'`. Hari TANPA baris = belum tertutup (§10.15:
 *                       ketiadaan bukti bukan bukti ketiadaan).
 *   2. **penampung**  — tak ada baris penampung yang belum dipindahkan dengan
 *                       TANGGAL BANK di bulan itu (bukan tanggal buku: baris
 *                       impor Oktober bisa dibukukan maju ke November, dan
 *                       yang ia tahan adalah Oktober).
 *   3. **rekening koran** — setiap rekening BCA wajib punya rekening koran AKTIF
 *                       bulan itu, DAN setiap baris impornya bertanggal bank di
 *                       bulan itu sudah selesai (tercocok/terklasifikasi/
 *                       diparkir; pra-cut-over tak pernah dicocokkan, R22).
 *                       Baris impor terbuka dilipat ke sini — bukan baris
 *                       kelima — karena yang menyelesaikannya layar yang sama
 *                       (klasifikasi rekening koran bulan itu), dan rencana
 *                       menetapkan EMPAT baris daftar periksa.
 *   4. **baris buku tanpa pasangan** — baris kas non-void di rekening wajib
 *                       dengan TANGGAL ASAL (tanggal_asal ?? hari buku) di
 *                       bulan itu yang tidak di kelompok cocok aktif, KECUALI
 *                       saldo pembuka dan pasangan baris-batal + pembalik
 *                       majunya yang bertaut dan berjumlah Rp 0.
 *
 * Nominal dalam SEN bulat.
 */

/** Kode alasan pembukuan maju baris PEMBALIK (batal cocok & balik pasangan antar unit). */
export const KODE_PEMBALIK_MAJU = KODE_MAJU_REVERSAL;

/** Bulan `YYYY-MM` sah? (pembantu bulan bersama: `bulan.ts`) */
export { bulanSah as bulanTutupSah, hariDalamBulan, hariTerakhir } from "./bulan";

const diBulan = (tanggal: string, bulan: string): boolean => tanggal.slice(0, 7) === bulan;

// ---------------------------------------------------------------------------
// Masukan
// ---------------------------------------------------------------------------

/** Baris penampung SUMBER (bukan pembalik pemindahannya). */
export interface BarisParkirBulan {
  id: string;
  accountId: string;
  /** Tanggal bank mutasi yang diparkir — penentu bulan (bukan hari buku). */
  tanggalBank: string;
  businessDate: string;
  amountSen: number;
  keterangan: string;
  /** Sudah ada baris pemindahan non-void yang menunjuknya (`parkir_sumber_id`). */
  sudahDipindah: boolean;
  /**
   * Tautan pembalik: pembatalan kelompok cocok di hari tertutup MEMBALIK baris
   * parkir dengan baris penampung `ADJ-FWD-REVERSAL` bertaut kelompok yang sama
   * (bukan memindahkannya). Pasangan itu bukan baris parkir terbuka.
   */
  alasanMaju: string | null;
  lahirDariCocokId: string | null;
}

/** Rekening BCA aktif bernomor (`PREDIKAT_REKENING_BCA`). Rekening bank lain tak pernah masuk ke sini. */
export interface RekeningWajib {
  id: string;
  nama: string;
  /** Saldo pembuka rekening (atau unit) — `null` = belum ada. */
  cutOver: string | null;
  /** Ada rekening koran berstatus aktif untuk bulan itu. */
  rekeningKoranAktif: boolean;
}

/** Baris impor rekening koran AKTIF. */
export interface BarisImporBulan {
  id: string;
  accountId: string;
  tanggalBank: string;
  praCutover: boolean;
  /** Anggota kelompok cocok AKTIF. */
  dicocokkan: boolean;
}

/** Baris kas di rekening wajib — calon "tanpa pasangan" + pasangan pembaliknya. */
export interface BarisBukuBulan {
  id: string;
  accountId: string;
  businessDate: string;
  tanggalAsal: string | null;
  amountSen: number;
  void: boolean;
  saldoAwal: boolean;
  dicocokkan: boolean;
  alasanMaju: string | null;
  lahirDariCocokId: string | null;
  pasanganUuid: string | null;
  keterangan: string;
  categoryLabel: string | null;
}

export interface MasukanTutupBulan {
  /** `YYYY-MM`. */
  bulan: string;
  /** Hari ber-`day_close` tertutup (boleh memuat bulan lain — disaring). */
  hariTertutup: readonly string[];
  parkir: readonly BarisParkirBulan[];
  rekening: readonly RekeningWajib[];
  impor: readonly BarisImporBulan[];
  buku: readonly BarisBukuBulan[];
}

// ---------------------------------------------------------------------------
// Vonis
// ---------------------------------------------------------------------------

export type JenisBukuTanpaPasangan =
  | "biasa"
  /**
   * Kaki pasangan antar unit (`pasangan_uuid`) yang tak punya mutasi bank di
   * rekening ini. ⚠️ ISU TERBUKA U11: klasifikasi "antar unit" atas kredit yang
   * diterima untuk unit lain melahirkan kaki unit lain itu di rekeningnya
   * sendiri — rekening koran unit itu TIDAK akan pernah memuatnya. Aturan R25
   * tetap dipakai apa adanya (ia menahan); jenis ini membuatnya dikenali.
   */
  | "kaki_antar_unit";

export interface BukuTanpaPasanganBulan extends BarisBukuBulan {
  jenis: JenisBukuTanpaPasangan;
  /** tanggal_asal ?? hari buku. */
  tanggalEfektif: string;
}

export interface VonisTutupBulan {
  boleh: boolean;
  syarat: {
    hari: { ok: boolean; jumlah: number; belum: string[] };
    penampung: { ok: boolean; jumlah: number; totalSen: number; baris: BarisParkirBulan[] };
    rekeningKoran: { ok: boolean; jumlah: number; belumDiimpor: RekeningWajib[]; imporTerbuka: number };
    bukuTanpaPasangan: { ok: boolean; jumlah: number; nKakiAntarUnit: number; baris: BukuTanpaPasanganBulan[] };
  };
  /** Satu kalimat per syarat yang gagal, urutan daftar periksa. Kosong ⇔ boleh. */
  alasan: string[];
}

const efektif = (b: BarisBukuBulan): string => b.tanggalAsal ?? b.businessDate;

const bertaut = (a: BarisBukuBulan, b: BarisBukuBulan): boolean =>
  (a.lahirDariCocokId !== null && a.lahirDariCocokId === b.lahirDariCocokId) ||
  (a.pasanganUuid !== null && a.pasanganUuid === b.pasanganUuid);

/**
 * Id baris yang termasuk pasangan baris-batal + pembalik MAJU: pembalik
 * (`ADJ-FWD-REVERSAL`) di rekening yang sama, bertaut (kelompok cocok yang
 * melahirkannya, atau `pasangan_uuid`), nominalnya tepat meniadakan. Satu
 * pembalik meniadakan SATU asli. Baris yang dicocokkan tak ikut dipasangkan.
 */
function pasanganBatal(buku: readonly BarisBukuBulan[]): Set<string> {
  const hidup = buku.filter((b) => !b.void && !b.saldoAwal && !b.dicocokkan);
  const asli = hidup.filter((b) => b.alasanMaju !== KODE_PEMBALIK_MAJU);
  const terpakai = new Set<string>();
  for (const p of hidup) {
    if (p.alasanMaju !== KODE_PEMBALIK_MAJU) continue;
    const o = asli.find(
      (a) => !terpakai.has(a.id) && a.accountId === p.accountId && a.amountSen + p.amountSen === 0 && bertaut(a, p),
    );
    if (!o) continue;
    terpakai.add(o.id);
    terpakai.add(p.id);
  }
  return terpakai;
}

/**
 * Baris parkir yang MASIH TERBUKA: belum dipindahkan, bukan pembalik, dan tidak
 * dibalik oleh pembalik maju yang bertaut (kelompok cocok sama, rekening sama,
 * nominal meniadakan). Dipakai vonis bulan DAN panel tutup hari (R24) — satu
 * definisi "masih diparkir".
 */
export function parkirTerbuka<T extends BarisParkirBulan>(parkir: readonly T[]): T[] {
  const dibalik = pasanganBatal(
    parkir.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      businessDate: p.businessDate,
      tanggalAsal: null,
      amountSen: p.amountSen,
      void: false,
      saldoAwal: false,
      dicocokkan: false,
      alasanMaju: p.alasanMaju,
      lahirDariCocokId: p.lahirDariCocokId,
      pasanganUuid: null,
      keterangan: p.keterangan,
      categoryLabel: null,
    })),
  );
  return parkir.filter((p) => !p.sudahDipindah && p.alasanMaju !== KODE_PEMBALIK_MAJU && !dibalik.has(p.id));
}

const rp = (sen: number): string =>
  `Rp ${(Math.abs(sen) / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

export function periksaTutupBulan(i: MasukanTutupBulan): VonisTutupBulan {
  const hari = hariDalamBulan(i.bulan); // melempar bila bulan tak sah
  const akhir = hari.at(-1)!;

  // 1. Hari
  const tutup = new Set(i.hariTertutup);
  const belum = hari.filter((d) => !tutup.has(d));

  // 2. Penampung — menurut TANGGAL BANK.
  const parkir = parkirTerbuka(i.parkir).filter((p) => diBulan(p.tanggalBank, i.bulan));
  const totalParkir = parkir.reduce((s, p) => s + p.amountSen, 0);

  // 3. Rekening koran — rekening yang saldo pembukanya sesudah bulan itu belum
  //    berbuku pada bulan itu, jadi tak dituntut.
  const wajib = i.rekening.filter((r) => r.cutOver === null || r.cutOver <= akhir);
  const idWajib = new Set(wajib.map((r) => r.id));
  const belumDiimpor = wajib.filter((r) => !r.rekeningKoranAktif);
  const imporTerbuka = i.impor.filter(
    (m) => idWajib.has(m.accountId) && diBulan(m.tanggalBank, i.bulan) && !m.praCutover && !m.dicocokkan,
  ).length;

  // 4. Baris buku tanpa pasangan.
  const diRekening = i.buku.filter((b) => idWajib.has(b.accountId));
  const batal = pasanganBatal(diRekening);
  const tanpa: BukuTanpaPasanganBulan[] = diRekening
    .filter((b) => !b.void && !b.saldoAwal && !b.dicocokkan && !batal.has(b.id) && diBulan(efektif(b), i.bulan))
    .map((b): BukuTanpaPasanganBulan => ({ ...b, tanggalEfektif: efektif(b), jenis: b.pasanganUuid !== null ? "kaki_antar_unit" : "biasa" }))
    .sort((a, b) => a.tanggalEfektif.localeCompare(b.tanggalEfektif) || a.id.localeCompare(b.id));
  const nKaki = tanpa.filter((b) => b.jenis === "kaki_antar_unit").length;

  const alasan: string[] = [];
  if (belum.length > 0) alasan.push(`${belum.length} hari di bulan ini belum ditutup.`);
  if (parkir.length > 0) {
    alasan.push(`Penampung belum nol: ${parkir.length} baris diparkir bertanggal bank di bulan ini (${rp(totalParkir)}).`);
  }
  if (belumDiimpor.length > 0 || imporTerbuka > 0) {
    const p: string[] = [];
    if (belumDiimpor.length > 0) p.push(`${belumDiimpor.length} rekening BCA belum diimpor rekening korannya`);
    if (imporTerbuka > 0) p.push(`${imporTerbuka} baris rekening koran belum dicocokkan/diklasifikasi`);
    alasan.push(`Rekening koran belum lengkap: ${p.join(" · ")}.`);
  }
  if (tanpa.length > 0) {
    alasan.push(
      `${tanpa.length} baris buku tanpa pasangan di rekening koran` +
        (nKaki > 0 ? ` (${nKaki} di antaranya kaki antar unit tanpa mutasi bank).` : "."),
    );
  }

  return {
    boleh: alasan.length === 0,
    syarat: {
      hari: { ok: belum.length === 0, jumlah: belum.length, belum },
      penampung: { ok: parkir.length === 0, jumlah: parkir.length, totalSen: totalParkir, baris: parkir },
      rekeningKoran: {
        ok: belumDiimpor.length === 0 && imporTerbuka === 0,
        jumlah: belumDiimpor.length + imporTerbuka,
        belumDiimpor,
        imporTerbuka,
      },
      bukuTanpaPasangan: { ok: tanpa.length === 0, jumlah: tanpa.length, nKakiAntarUnit: nKaki, baris: tanpa },
    },
    alasan,
  };
}
