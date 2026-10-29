import type { JenisPihakLawan, SaldoAwalPihakLawan } from "./pihak-lawan-model";
import { KATEGORI_HUTANG_PIUTANG, type MutasiSisiKas } from "./keuangan-sisi-kas";
import {
  KATEGORI_PENYERAHAN_TITIPAN,
  KATEGORI_PENYERAHAN_TITIPAN_BRIGHT,
  NAMA_PEMILIK_BRIGHT,
  type TitipanDiterima,
} from "./titipan-bright";

/**
 * Buku pembantu pihak lawan (rencana 2026-10-29 U6; R2) — MURNI.
 *
 * Saldo per (unit, pihak lawan) per tanggal + rincian mutasi bersaldo berjalan.
 * ⛔ Angkanya HARUS sama dengan neraca: pihak lawan non-titipan = aturan
 * `saldoPihakLawan` atas baris Hutang Piutang (term `sisiKasNeraca`), pemilik
 * titipan = aturan `saldoTitipanPerPemilik` (Rincian diterima + penyerahan +
 * pembuka). Rincian bersaldo-berjalan butuh baris per baris, jadi aturannya
 * ditulis ulang di sini — dan kesamaannya dengan kedua fungsi itu DIUJI
 * (`buku-pembantu-model.test.ts`), bukan diandaikan.
 *
 * Tanda: POSITIF = piutang (pihak lawan berhutang ke unit), searah 0049.
 */

export interface PihakLawanBuku {
  id: string;
  jenis: JenisPihakLawan;
  nama: string;
  aktif: boolean;
  lawanUnitId: number | null;
  saldoAwal: SaldoAwalPihakLawan | null;
}

export interface BarisRincian {
  /** Hari buku. */
  hariBuku: string;
  /** Tanggal asal bila dibukukan maju (R28), selain itu `null`. */
  tanggalAsal: string | null;
  keterangan: string;
  /** Pengaruh pada saldo (sen, positif = piutang bertambah). */
  efekSen: number;
  /** Saldo SESUDAH baris ini (sen). */
  saldoSen: number;
}

export interface BarisBukuPembantu {
  id: string;
  jenis: JenisPihakLawan;
  nama: string;
  aktif: boolean;
  lawanUnitId: number | null;
  saldoAwal: SaldoAwalPihakLawan | null;
  /** Saldo pada AKHIR `per` (sen). */
  saldoSen: number;
  /** "Piutang" / "Hutang" — `null` bila nol. Nilai MUTLAK ditampilkan di sampingnya. */
  arah: "Piutang" | "Hutang" | null;
  /** Saldo pembuka yang berlaku masih sementara (§10.26). */
  sementara: boolean;
  /** Baris yang mendahului saldo pembuka — termuat di dalamnya, tak dijumlah. */
  nPraSaldoAwal: number;
  rincian: BarisRincian[];
}

const sen = (rp: number): number => Math.round(rp * 100);
const arahDari = (s: number): BarisBukuPembantu["arah"] => (s > 0 ? "Piutang" : s < 0 ? "Hutang" : null);

interface Gerak {
  hariBuku: string;
  tanggalAsal: string | null;
  keterangan: string;
  efekSen: number;
}

function berjalan(awal: SaldoAwalPihakLawan | null, per: string, gerak: Gerak[]): { rincian: BarisRincian[]; saldoSen: number; pra: number } {
  const berlaku = awal !== null && awal.tanggal <= per;
  let saldo = berlaku ? awal.amountSen : 0;
  let pra = 0;
  const rincian: BarisRincian[] = [];
  if (berlaku) {
    rincian.push({ hariBuku: awal.tanggal, tanggalAsal: null, keterangan: `Saldo pembuka${awal.sementara ? " (sementara)" : ""}`, efekSen: awal.amountSen, saldoSen: saldo });
  }
  for (const g of [...gerak].sort((a, b) => (a.hariBuku < b.hariBuku ? -1 : a.hariBuku > b.hariBuku ? 1 : 0))) {
    if (g.hariBuku > per) continue;
    if (berlaku && g.hariBuku < awal.tanggal) {
      pra++;
      continue;
    }
    saldo += g.efekSen;
    rincian.push({ ...g, saldoSen: saldo });
  }
  return { rincian, saldoSen: saldo || 0, pra };
}

export function bukuPembantu(a: {
  per: string;
  pihak: readonly PihakLawanBuku[];
  mutasi: readonly (MutasiSisiKas & { keterangan?: string })[];
  /** `null` = buku titipan belum dimulai pada `per` (sama dengan neraca). */
  titipanDiterima: readonly TitipanDiterima[] | null;
}): BarisBukuPembantu[] {
  const hidup = a.mutasi.filter((m) => !m.void && m.businessDate <= a.per);
  const bright = a.pihak.find((p) => p.jenis === "titipan" && p.nama === NAMA_PEMILIK_BRIGHT)?.id ?? null;
  const ket = (m: { keterangan?: string; categoryLabel: string | null }) => m.keterangan ?? m.categoryLabel ?? "";

  return a.pihak.map((p) => {
    let gerak: Gerak[];
    if (p.jenis !== "titipan") {
      gerak = hidup
        .filter((m) => m.categoryLabel === KATEGORI_HUTANG_PIUTANG && m.pihakLawanId === p.id)
        .map((m) => ({ hariBuku: m.businessDate, tanggalAsal: m.tanggalAsal ?? null, keterangan: ket(m), efekSen: -sen(m.amount) }));
    } else if (a.titipanDiterima === null) {
      gerak = [];
    } else {
      const milik = (pid: string | null | undefined) => (pid ?? bright) === p.id;
      gerak = [
        ...a.titipanDiterima
          .filter((d) => d.rp !== 0 && milik(d.pihakLawanId))
          .map((d) => ({
            hariBuku: d.businessDate ?? a.per,
            tanggalAsal: null,
            keterangan: "Titipan diterima (Rincian pengawas)",
            efekSen: -sen(d.rp),
          })),
        ...hidup
          .filter(
            (m) =>
              (m.categoryLabel === KATEGORI_PENYERAHAN_TITIPAN && milik(m.pihakLawanId)) ||
              (m.categoryLabel === KATEGORI_PENYERAHAN_TITIPAN_BRIGHT && p.id === bright),
          )
          .map((m) => ({ hariBuku: m.businessDate, tanggalAsal: m.tanggalAsal ?? null, keterangan: ket(m), efekSen: -sen(m.amount) })),
      ];
    }
    const awal = p.jenis === "titipan" && a.titipanDiterima === null ? null : p.saldoAwal;
    const r = berjalan(awal, a.per, gerak);
    const sementara = awal !== null && awal.tanggal <= a.per && awal.sementara;
    return {
      id: p.id,
      jenis: p.jenis,
      nama: p.nama,
      aktif: p.aktif,
      lawanUnitId: p.lawanUnitId,
      saldoAwal: p.saldoAwal,
      saldoSen: r.saldoSen,
      arah: arahDari(r.saldoSen),
      sementara,
      nPraSaldoAwal: r.pra,
      rincian: r.rincian,
    };
  });
}

/** Status pasangan unit untuk kolom Status (R3/R4/R5). */
export interface StatusPasanganUnit {
  /** "Dalam perjalanan" bila ada kaki hidup yang belum lunas di bank; "Lunas di bank" bila semua lunas. */
  kaki: "Dalam perjalanan" | "Lunas di bank" | null;
  satuPt: boolean;
  /** `true` = R4 dilanggar di luar jendela (hanya bila pembaca memegang kedua unit). */
  tidakSeimbang: boolean;
}

export function statusPasangan(
  kaki: readonly { lawanUnitId: number; status: "dalam_perjalanan" | "lunas_di_bank" | "dibatalkan" }[],
  lawanUnitId: number,
  o: { satuPt: boolean; tidakSeimbang: boolean },
): StatusPasanganUnit {
  const hidup = kaki.filter((k) => k.lawanUnitId === lawanUnitId && k.status !== "dibatalkan");
  return {
    kaki: hidup.length === 0 ? null : hidup.some((k) => k.status === "dalam_perjalanan") ? "Dalam perjalanan" : "Lunas di bank",
    satuPt: o.satuPt,
    tidakSeimbang: o.tidakSeimbang,
  };
}
