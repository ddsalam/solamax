/**
 * Titipan outlet (KEUANGAN-HARIAN §10.27, diperluas rencana 2026-10-29 U5 /
 * KTD11) — SATU tempat aturannya.
 *
 * ⛔ KEPUTUSAN OWNER 26 Sep 2026: "Setoran Bright" di Rincian Penjualan adalah
 * **titipan** hasil penjualan outlet Bright di tiap SPBU — BUKAN pendapatan SPBU.
 * Uangnya masuk laci & disetor bersama kas SPBU (jadi tetap ikut rekonsiliasi
 * kas pengawas, komponen F), tetapi ia UTANG kepada outlet Bright/SPH sampai
 * diserahkan.
 *
 * Akibat di laporan keuangan:
 *   · Laba rugi — TIDAK masuk pendapatan lain-lain;
 *   · Arus kas — baris sendiri titipan (masuk − diserahkan);
 *   · Neraca — LIABILITAS titipan = Σ titipan − Σ penyerahan sejak buku kas
 *     dimulai. Kas naik, utang naik, laba tak berubah ⇒ langkah harian tetap
 *     seimbang.
 *
 * Produksi 12–25 Sep 2026: 105 baris "setoran bright" di KETUJUH unit dicatat
 * sebagai pendapatan lain — laba SPBU lebih saji tiap hari.
 *
 * U5 (KTD11) — **titipan punya PEMILIK** (pihak lawan berjenis `titipan`:
 * "Outlet Bright" disemai 0049 per unit, Kebab dst. ditambah Keuangan). Pengawas
 * memilih pemiliknya secara eksplisit (`manual_entry.pihak_lawan_id`, kolom
 * milik pengawas §2.1). Baris LAMA tanpa pemilik dipetakan ke "Outlet Bright".
 * Pemilik baru TIDAK punya pengenal berbasis kata: "SETORAN KEBAB" tanpa
 * kategori titipan bukan titipan.
 *
 * ⚠️ Berkas ini dimuat komponen klien (formulir Rincian) — tetap MURNI, tanpa I/O.
 */

/**
 * Kategori operasional (milik pengawas, §2.1) yang ditulis untuk SETIAP baris
 * titipan baru, pemilik siapa pun. Pemiliknya disimpan di `pihak_lawan_id`,
 * bukan di label — label yang menyebut "Bright" pada titipan Kebab akan
 * tersimpan salah selamanya.
 */
export const KATEGORI_TITIPAN = "Titipan outlet";

/**
 * Kategori operasional LAMA (§10.27, 26 Sep – U5). Baris yang sudah tersimpan
 * dengannya tetap titipan; tak ada baris baru yang ditulis dengannya.
 */
export const KATEGORI_TITIPAN_BRIGHT = "Titipan outlet Bright";

/** Semua kategori operasional yang berarti titipan. */
export const KATEGORI_TITIPAN_SEMUA = [KATEGORI_TITIPAN, KATEGORI_TITIPAN_BRIGHT] as const;

/** Kategori mutasi kas (kredit, 0049) — penyerahan ke pemilik titipan; WAJIB pihak lawan. */
export const KATEGORI_PENYERAHAN_TITIPAN = "Penyerahan titipan";

/** Kategori mutasi kas LAMA (kredit, 0045) — selalu terhitung untuk Outlet Bright. */
export const KATEGORI_PENYERAHAN_TITIPAN_BRIGHT = "Penyerahan titipan Bright";

/** Nama pemilik titipan yang disemai 0049 di setiap unit. */
export const NAMA_PEMILIK_BRIGHT = "Outlet Bright";

/**
 * Baris LAMA (sebelum pilihan kategori ada) dikenali dari keterangannya:
 * kata "bright" atau "titipan" utuh. Hanya untuk baris TANPA kategori — begitu
 * pengawas memilih kategori, pilihannya yang berlaku, bukan tebakan ini.
 */
export const POLA_KETERANGAN_TITIPAN = /(^|[^a-z])(bright|titipan)([^a-z]|$)/i;

export interface BarisPendapatanLain {
  section: string;
  operationalCategory: string | null;
  keterangan: string;
}

/** Vonis tunggal (TS). Padanan SQL: {@link sqlTitipan}. */
export function isTitipan(r: BarisPendapatanLain): boolean {
  if (r.section !== "pendapatan_lain") return false;
  if (r.operationalCategory !== null) {
    return (KATEGORI_TITIPAN_SEMUA as readonly string[]).includes(r.operationalCategory);
  }
  return POLA_KETERANGAN_TITIPAN.test(r.keterangan);
}

/**
 * Padanan SQL dari {@link isTitipan} untuk alias tabel `manual_entry`.
 * Regex POSIX Postgres setara dengan pola TS di atas (`~*` = tak peka huruf).
 */
export function sqlTitipan(a: string): string {
  return `(${a}.section = 'pendapatan_lain' AND (
    ${a}.operational_category IN ('${KATEGORI_TITIPAN}', '${KATEGORI_TITIPAN_BRIGHT}')
    OR (${a}.operational_category IS NULL
        AND ${a}.keterangan ~* '(^|[^a-z])(bright|titipan)([^a-z]|$)')))`;
}

/** Pemilik titipan AKTIF unit ini (pihak lawan berjenis titipan) — pilihan formulir. */
export interface PilihanPemilikTitipan {
  id: string;
  nama: string;
}

/**
 * Pemilik yang DIPILIH LEBIH DULU di formulir: "Outlet Bright" hanya bila
 * keterangan berbunyi seperti baris lama yang dikenali §10.27; selain itu
 * kosong — pengawas wajib memilih.
 */
export function pemilikAwal(ket: string, pemilik: readonly PilihanPemilikTitipan[]): string {
  if (!POLA_KETERANGAN_TITIPAN.test(ket)) return "";
  return pemilik.find((p) => p.nama === NAMA_PEMILIK_BRIGHT)?.id ?? "";
}

// ---------------------------------------------------------------------------
// Saldo titipan per pemilik
// ---------------------------------------------------------------------------

/**
 * Σ titipan diterima (Rincian) per pemilik. `pihakLawanId` `null` = baris
 * TANPA pemilik (baris lama) ⇒ Outlet Bright. `nama` `null` = pemilik yang
 * tidak (lagi) terbaca sebagai pemilik titipan unit ini.
 */
export interface TitipanDiterima {
  pihakLawanId: string | null;
  nama: string | null;
  rp: number;
  /**
   * U6 — hari buku baris yang dijumlah (`YYYY-MM-DD`). Bila ada, baris yang
   * mendahului saldo pembuka pemiliknya tidak dijumlah (sudah termuat di
   * pembuka). `undefined`/`null` = agregat tanpa tanggal (perilaku U5).
   */
  businessDate?: string | null;
}

/**
 * U6 — saldo pembuka pemilik titipan (`pihak_lawan_saldo_awal`, tanda 0049:
 * POSITIF = piutang). Bagi pemilik titipan, saldo yang dibawa masuk adalah
 * UTANG ⇒ liabilitas = −amount. Dikunci id pihak lawan.
 */
export interface SaldoAwalTitipan {
  tanggal: string;
  amountSen: number;
  sementara: boolean;
}

export interface MutasiPenyerahan {
  businessDate: string;
  categoryLabel: string | null;
  pihakLawanId?: string | null;
  amount: number;
  void: boolean;
}

export interface SaldoTitipanPemilik {
  /** `null` hanya bila unit tak punya baris "Outlet Bright" (unit lahir sesudah 0049). */
  pihakLawanId: string | null;
  nama: string;
  /** Rupiah, POSITIF = utang ke pemilik. */
  saldo: number;
}

const sen = (rp: number): number => Math.round(rp * 100);

/**
 * Saldo titipan per pemilik sampai `sampai`: Σ diterima + Σ penyerahan
 * (tersimpan KREDIT, negatif). Penyerahan "Penyerahan titipan Bright" (0045)
 * dan titipan tanpa pemilik terhitung untuk Outlet Bright. Dihitung dalam sen
 * bulat. Hanya pemilik yang punya gerakan yang dikembalikan, urut nama.
 *
 * U6 — `saldoAwal` (opsional): saldo pembuka per pemilik. Yang berlaku pada
 * `sampai` (tanggal ≤ sampai) DITAMBAHKAN sebagai utang (−amount) dan baris
 * pemilik itu yang bertanggal SEBELUM pembukanya tidak dijumlah — aturan yang
 * sama dengan `saldoPihakLawan` (§10.24 butir 2: dihitung dua kali bila
 * dijumlah). Inilah satu-satunya tempat pembuka pemilik titipan masuk neraca;
 * term pihak lawan neraca SENGAJA melewati jenis titipan supaya tak dihitung dua kali.
 */
export function saldoTitipanPerPemilik(
  diterima: readonly TitipanDiterima[],
  mutasi: readonly MutasiPenyerahan[],
  sampai: string,
  saldoAwal: ReadonlyMap<string, SaldoAwalTitipan> = new Map(),
): SaldoTitipanPemilik[] {
  const bright = diterima.find((d) => d.pihakLawanId !== null && d.nama === NAMA_PEMILIK_BRIGHT)?.pihakLawanId ?? null;
  const nama = new Map<string | null, string>();
  for (const d of diterima) if (d.pihakLawanId !== null) nama.set(d.pihakLawanId, d.nama ?? d.pihakLawanId);
  nama.set(bright, NAMA_PEMILIK_BRIGHT);

  const saldo = new Map<string | null, number>();
  const tambah = (k: string | null, rp: number) => saldo.set(k, (saldo.get(k) ?? 0) + sen(rp));
  /** Pembuka pemilik `k` yang berlaku pada `sampai`, bila ada. */
  const pembuka = (k: string | null) => {
    const a = k === null ? undefined : saldoAwal.get(k);
    return a !== undefined && a.tanggal <= sampai ? a : undefined;
  };
  /** Baris bertanggal `d` milik `k` sudah termuat di pembukanya? */
  const praPembuka = (k: string | null, d: string | null | undefined) => {
    const a = pembuka(k);
    return a !== undefined && d != null && d < a.tanggal;
  };

  for (const [k, a] of saldoAwal) {
    if (pembuka(k) === undefined) continue;
    // Utang yang dibawa masuk: tanda 0049 positif = piutang ⇒ utang = −amount.
    saldo.set(k, (saldo.get(k) ?? 0) - a.amountSen);
  }
  for (const d of diterima) {
    if (d.rp === 0) continue;
    const k = d.pihakLawanId ?? bright;
    if (praPembuka(k, d.businessDate)) continue;
    tambah(k, d.rp);
  }
  for (const m of mutasi) {
    if (m.void || m.businessDate > sampai) continue;
    const k =
      m.categoryLabel === KATEGORI_PENYERAHAN_TITIPAN_BRIGHT
        ? bright
        : m.categoryLabel === KATEGORI_PENYERAHAN_TITIPAN
          ? (m.pihakLawanId ?? bright)
          : undefined;
    if (k === undefined || praPembuka(k, m.businessDate)) continue;
    tambah(k, m.amount);
  }

  return [...saldo.entries()]
    .map(([k, s]) => ({ pihakLawanId: k, nama: nama.get(k) ?? k ?? NAMA_PEMILIK_BRIGHT, saldo: s / 100 }))
    .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
}

/** Liabilitas titipan GABUNGAN (semua pemilik) — baris neraca & arus kas yang sudah ada. */
export function totalSaldoTitipan(per: readonly SaldoTitipanPemilik[]): number {
  return per.reduce((s, p) => s + sen(p.saldo), 0) / 100;
}
