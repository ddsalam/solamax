/**
 * Penjaga INTEGRITAS taut polimorfik koreksi/reklasifikasi.
 *
 * Latar: `correction_entry.original_txn_id` dan `reclassification.source_txn_id`
 * sengaja TANPA foreign key (keputusan owner 12 Agu 2026, KEUANGAN-HARIAN §10.10).
 * Alasannya bukan "biar fleksibel": model keuangan sudah berkomitmen pada buku
 * kas besar, lima buku bank, dan settlement EDC sebagai ledger terpisah
 * (§1.3–§1.4), jadi sumber kedua bukan kemungkinan melainkan jadwal. FK ke
 * `manual_entry` hari ini berarti mencabutnya nanti — migrasi di tabel yang
 * sudah berisi entri koreksi.
 *
 * ⛔ Tetapi "tanpa FK" tidak boleh berarti "tanpa integritas". Yang hilang saat
 * FK dilepas adalah jaminan bahwa taut menunjuk sesuatu yang ADA. Modul ini
 * mengembalikannya sebagai pemeriksaan, bukan sebagai jaminan — bedanya: ia
 * menemukan pelanggaran SETELAH terjadi, bukan mencegahnya. Karena itu ia harus
 * benar-benar dijalankan, dan harus bisa berbunyi merah.
 *
 * Dua kelas temuan, sengaja dibedakan:
 *  · `kind_unknown` — `source_kind` di luar daftar tertutup. Mestinya mustahil
 *    (CHECK 0025), jadi kemunculannya berarti CHECK-nya hilang atau ada jalur
 *    tulis yang melewati aplikasi. Itu temuan yang LEBIH berat dari yatim biasa.
 *  · `orphan` — jenisnya sah, tetapi barisnya tidak ada di tabel tujuan.
 *
 * ⚠️ KEWAJIBAN SAAT LEDGER KEDUA LAHIR: tambahkan nilainya ke `SUMBER_SAH` DAN
 * ke pengambilan id di `ORPHAN_SQL` **di PR yang sama** dengan migrasi yang
 * memperluas CHECK `source_kind`. Penjaga yang tertinggal satu rilis adalah
 * penjaga yang buta terhadap justru sumber yang baru.
 */

/** Daftar TERTUTUP, cermin CHECK di migrasi 0025. Hari ini tepat satu nilai. */
export const SUMBER_SAH = ["manual_entry"] as const;
export type SumberSah = (typeof SUMBER_SAH)[number];

export interface TautSumber {
  /** Tabel asal barisnya — supaya laporan menyebut tempat, bukan hanya id. */
  tabel: "correction_entry" | "reclassification";
  id: string;
  sourceKind: string;
  sourceTxnId: string;
}

export interface TemuanIntegritas extends TautSumber {
  masalah: "orphan" | "kind_unknown";
}

/**
 * Cari taut yang menunjuk ke ketiadaan.
 *
 * `idTersedia` memetakan `source_kind` → himpunan id yang benar-benar ada.
 * Sengaja himpunan (bukan pemanggilan balik ke DB) supaya fungsi ini MURNI dan
 * bisa diuji tanpa database — lapis SQL-nya cukup mengambil id, tak perlu
 * mengulang aturannya.
 *
 * Jenis yang tak dikenal dilaporkan sebagai temuan, **bukan dilewati**. Melewati
 * yang tak dikenal adalah cara penjaga berubah jadi hijau-tanpa-subjek: ia
 * berhenti memeriksa persis pada baris yang paling mencurigakan.
 */
export function cariYatim(
  taut: readonly TautSumber[],
  idTersedia: Readonly<Partial<Record<string, ReadonlySet<string>>>>,
): TemuanIntegritas[] {
  const sah = new Set<string>(SUMBER_SAH);
  const out: TemuanIntegritas[] = [];
  for (const t of taut) {
    if (!sah.has(t.sourceKind)) {
      out.push({ ...t, masalah: "kind_unknown" });
      continue;
    }
    const ada = idTersedia[t.sourceKind];
    if (!ada || !ada.has(t.sourceTxnId)) out.push({ ...t, masalah: "orphan" });
  }
  return out;
}

/**
 * SQL pemeriksa untuk dijalankan terhadap DB hidup (uji integrasi / pemeriksaan
 * rutin). Ia mengembalikan BARIS TAUT-nya saja; keputusan yatim/tidak tetap di
 * `cariYatim`, supaya hanya ada SATU tempat yang memutuskan.
 *
 * Tidak ber-parameter unit: pemeriksaan integritas justru harus melihat semua
 * yang terlihat oleh pemanggilnya — RLS yang membatasinya, bukan klausa di sini.
 */
export const TAUT_SQL = `
  SELECT 'correction_entry' AS tabel, id::text, source_kind, original_txn_id::text AS source_txn_id
    FROM app.correction_entry
  UNION ALL
  SELECT 'reclassification' AS tabel, id::text, source_kind, source_txn_id::text
    FROM app.reclassification
`;

/** Id yang benar-benar ada, per `source_kind`. Tambah SATU baris per ledger baru. */
export const SUMBER_ID_SQL: Readonly<Record<SumberSah, string>> = {
  manual_entry: "SELECT id::text FROM app.manual_entry",
};

/** Ringkasan sekali-baca untuk laporan/log. */
export function ringkasTemuan(temuan: readonly TemuanIntegritas[]): string {
  if (temuan.length === 0) return "integritas taut: bersih";
  const yatim = temuan.filter((t) => t.masalah === "orphan").length;
  const tak = temuan.length - yatim;
  return `integritas taut: ${temuan.length} temuan (${yatim} yatim, ${tak} jenis tak dikenal)`;
}

// ---------------------------------------------------------------------------
// Kelompok cocok rekening koran (rencana 2026-10-29 U10; KTD6)
//
// Partial unique 0052 MENCEGAH keanggotaan ganda dan aksi MENEGAKKAN Σ = 0;
// pemeriksaan ini MENEMUKAN pelanggaran sesudah terjadi — indeks yang hilang,
// jalur tulis yang melewati aksi, atau baris kas anggota yang kemudian di-void
// lewat jalur ketik lama (`simpanMutasiKas` tak tahu kelompok cocok).
// ---------------------------------------------------------------------------

export interface AnggotaCocok {
  cocokId: string;
  unitId: number;
  jenis: "mutasi" | "kas";
  anggotaId: string;
  accountId: string;
  /** BERTANDA, sen bulat. */
  amountSen: number;
  /** Baris kas anggota sudah di-void. */
  void: boolean;
  /** Baris impor anggota pra-cut-over atau milik rekening koran ditarik. */
  mutasiTakSah: boolean;
}

export type MasalahCocok = "sigma-tidak-nol" | "keanggotaan-ganda" | "anggota-void" | "tanpa-baris-bank" | "baris-bank-tak-sah";

export interface TemuanCocok {
  masalah: MasalahCocok;
  cocokId: string;
  unitId: number;
  /** Id anggota bermasalah (keanggotaan ganda / void / tak sah). */
  anggotaId?: string;
  /** Kelompok AKTIF lain yang juga memuat anggota itu. */
  cocokLain?: string[];
  /** Σ bank − Σ buku pada rekening itu, sen. */
  selisihSen?: number;
  accountId?: string;
}

/** Anggota kelompok cocok AKTIF beserta nominalnya — dibaca apa adanya, vonis di `periksaKelompokCocok`. */
export const ANGGOTA_COCOK_AKTIF_SQL = `
  SELECT b.cocok_id::text AS "cocokId", b.unit_id AS "unitId",
         CASE WHEN b.mutasi_bank_id IS NOT NULL THEN 'mutasi' ELSE 'kas' END AS jenis,
         COALESCE(b.mutasi_bank_id, b.cash_ledger_id)::text AS "anggotaId",
         COALESCE(m.account_id, l.account_id)::text AS "accountId",
         COALESCE(m.amount, l.amount)::text AS amount,
         COALESCE(l.void, false) AS void,
         COALESCE(m.pra_cutover OR m.rk_status <> 'aktif', false) AS "mutasiTakSah"
    FROM app.cocok_bank_baris b
    LEFT JOIN app.mutasi_bank m ON m.id = b.mutasi_bank_id AND m.unit_id = b.unit_id
    LEFT JOIN app.cash_ledger l ON l.id = b.cash_ledger_id AND l.unit_id = b.unit_id
   WHERE b.aktif
`;

/**
 * Vonis integritas kelompok cocok AKTIF: Σ bank = Σ buku per rekening (tepat
 * Rp 0), tiap baris di paling banyak satu kelompok aktif, minimal satu baris
 * bank per kelompok, anggota kas tidak void, anggota bank masih sah.
 * Baris kas void TETAP dihitung dalam Σ — kelompoknya memang sudah tak seimbang
 * terhadap buku; temuan `anggota-void` menyebut sebabnya.
 */
export function periksaKelompokCocok(anggota: readonly AnggotaCocok[]): TemuanCocok[] {
  const out: TemuanCocok[] = [];
  const perAnggota = new Map<string, Set<string>>();
  const perKelompok = new Map<string, AnggotaCocok[]>();
  for (const a of anggota) {
    const k = `${a.jenis}:${a.anggotaId}`;
    perAnggota.set(k, (perAnggota.get(k) ?? new Set()).add(a.cocokId));
    perKelompok.set(a.cocokId, [...(perKelompok.get(a.cocokId) ?? []), a]);
  }
  for (const [cocokId, rows] of perKelompok) {
    const unitId = rows[0]!.unitId;
    if (!rows.some((r) => r.jenis === "mutasi")) out.push({ masalah: "tanpa-baris-bank", cocokId, unitId });
    for (const r of rows) {
      const lain = [...(perAnggota.get(`${r.jenis}:${r.anggotaId}`) ?? [])].filter((x) => x !== cocokId);
      if (lain.length > 0) out.push({ masalah: "keanggotaan-ganda", cocokId, unitId, anggotaId: r.anggotaId, cocokLain: lain });
      if (r.jenis === "kas" && r.void) out.push({ masalah: "anggota-void", cocokId, unitId, anggotaId: r.anggotaId });
      if (r.jenis === "mutasi" && r.mutasiTakSah) out.push({ masalah: "baris-bank-tak-sah", cocokId, unitId, anggotaId: r.anggotaId });
    }
    for (const akun of new Set(rows.map((r) => r.accountId))) {
      const di = rows.filter((r) => r.accountId === akun);
      const selisihSen =
        di.filter((r) => r.jenis === "mutasi").reduce((t, r) => t + r.amountSen, 0) -
        di.filter((r) => r.jenis === "kas").reduce((t, r) => t + r.amountSen, 0);
      if (selisihSen !== 0) out.push({ masalah: "sigma-tidak-nol", cocokId, unitId, accountId: akun, selisihSen });
    }
  }
  return out;
}

export function ringkasTemuanCocok(temuan: readonly TemuanCocok[]): string {
  if (temuan.length === 0) return "integritas kelompok cocok: bersih";
  const n = (m: MasalahCocok) => temuan.filter((t) => t.masalah === m).length;
  return (
    `integritas kelompok cocok: ${temuan.length} temuan (${n("sigma-tidak-nol")} Σ≠0, ` +
    `${n("keanggotaan-ganda")} keanggotaan ganda, ${n("anggota-void")} anggota void, ` +
    `${n("tanpa-baris-bank")} tanpa baris bank, ${n("baris-bank-tak-sah")} baris bank tak sah)`
  );
}
