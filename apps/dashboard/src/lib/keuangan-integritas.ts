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
