/**
 * Konfigurasi UPSERT per tabel target. `columns` = key payload (snake_case,
 * sudah tervalidasi zod @solamax/shared) = nama kolom Postgres. `conflict` =
 * natural key target ON CONFLICT (lihat ARCHITECTURE.md §3 — TERKUNCI).
 * Identifier HANYA berasal dari konstanta ini (tak pernah dari input).
 */
export interface TableConfig {
  /** Nama tabel Postgres. */
  table: string;
  /** Kolom payload, urutan tetap. */
  columns: readonly string[];
  /**
   * Target ON CONFLICT (selain unit_id yang selalu ikut). Kosong = tanpa ON
   * CONFLICT. Mode UPSERT: WAJIB diisi (kunci natural). Mode REPLACE: opsional —
   * bila diisi, INSERT-nya pakai ON CONFLICT DO UPDATE sebagai jaring anti-kembar
   * saat REPLACE bersamaan (edc); kosong = REPLACE polos (pelanggan/voucher).
   */
  conflict: readonly string[];
  /** Punya kolom ingested_at yang di-refresh saat update. */
  hasIngestedAt: boolean;
  /**
   * REPLACE per (unit_id, business_date): DELETE baris business_date di payload
   * lalu INSERT — utk tabel tanpa PK baris bersih (edc/pelanggan_sale/voucher_sale).
   * Agent WAJIB mengirim satu business_date utuh per payload (jangan terpisah).
   * Bila `conflict` diisi (edc), INSERT memakai ON CONFLICT DO UPDATE → REPLACE
   * tetap aman walau dua /ingest tumpang-tindih (lihat catatan edc di bawah).
   */
  replaceByBusinessDate?: boolean;
  /**
   * Kolom yang DIJUMLAH saat dua baris berbagi conflict-key yang sama dalam satu
   * batch. Sumber bisa punya banyak baris per natural-key (mis. tr_dtebus: satu DO
   * menebus produk sama di beberapa baris) → tanpa agregasi, UPSERT gagal Postgres
   * 21000 ("ON CONFLICT … cannot affect row a second time"). Jaring backend
   * (defense-in-depth); agent idealnya sudah meng-agregat di sumber.
   */
  sumOnConflict?: readonly string[];
  /**
   * Lewati UPDATE bila SEMUA kolom non-key identik dengan yang sudah tersimpan
   * (`DO UPDATE … WHERE (…) IS DISTINCT FROM (EXCLUDED.…)`).
   *
   * Untuk domain FULL-SYNC, tiap cadence meng-UPSERT SELURUH ledger. Postgres
   * tak punya update in-place: tiap UPDATE membuat tuple baru dan menandai yang
   * lama mati, jadi menulis ulang baris yang isinya sama persis tetap
   * menggandakan tabel. Terukur 2026-08-05 di pilot — autovacuum sudah jalan
   * ratusan kali dan TETAP kalah:
   *
   *     bppiut       2.786.477 hidup / 7.942.202 mati = 74,0%  · 2134 MB
   *     bphut          531.044 hidup / 2.081.686 mati = 79,7%  ·  477 MB
   *     deposit         12.444 hidup /   951.133 mati = 98,7%  ·  132 MB
   *     terra_resmi     10.127 hidup /   762.102 mati = 98,7%  ·  104 MB
   *     delivery        80.067 hidup /       695 mati =  0,9%  ·   25 MB  ← inkremental
   *
   * ⚠️ BAHAYANYA KOREKTNESS, BUKAN PERFORMA: predikat WAJIB mencakup SEMUA
   * kolom yang di-SET. Kolom yang terlewat = perubahan nyata pada kolom itu
   * DIAM-DIAM berhenti mendarat di mirror — jauh lebih buruk daripada tabel
   * gembung. `ingested_at` sengaja DI LUAR predikat (ia selalu now(); kalau ikut,
   * tiap baris selalu "berbeda" dan seluruh mekanismenya tak berguna) — tapi ia
   * juga berhenti di-refresh untuk baris yang tak berubah, dan itu memang
   * diinginkan: `ingested_at` jadi "kapan baris ini terakhir BERUBAH".
   */
  skipUnchanged?: boolean;
}

export const TABLE_CONFIG: Record<string, TableConfig> = {
  sales_header: {
    table: "sales_header",
    columns: ["ckdjualbbm", "dtgljual", "nshift", "vcket"],
    conflict: ["ckdjualbbm"],
    hasIngestedAt: false,
  },
  sales_detail: {
    table: "sales_detail",
    columns: [
      "ckdjualbbm", "ckdnozzle", "nurut", "nstandawal", "nstandakhir",
      "nvolume", "nhargajual", "nsubtotal", "ckdbbm", "ckdtangki",
      "vcopeator", "dtgljam", "subah", "sedit",
    ],
    conflict: ["ckdjualbbm", "ckdnozzle", "nurut"],
    hasIngestedAt: true,
  },
  cash_header: {
    table: "cash_header",
    columns: [
      "ckdkb", "dtgl", "vcket", "sjnstrans", "ntotal", "vcref", "ctmpkas", "sbatal",
    ],
    conflict: ["ckdkb"],
    hasIngestedAt: true,
  },
  cash_detail: {
    table: "cash_detail",
    columns: ["ckdkb", "ckdperk", "njumlah"],
    conflict: ["ckdkb", "ckdperk"],
    hasIngestedAt: true,
  },
  opname: {
    table: "opname",
    columns: [
      "ckdopnbbm", "ckdtangki", "ckdbbm", "dtaglopn", "nstockbk",
      "nstockop", "nvolselisih", "dtgljam", "sbatal",
    ],
    conflict: ["ckdopnbbm", "ckdtangki"],
    hasIngestedAt: true,
  },
  delivery: {
    table: "delivery",
    columns: [
      "ckdtrm", "dtgltrm", "dtgljam", "cnodo", "cnoso", "nvoldo", "nvolreal",
      "nvolselisih", "cnopol", "vcsopir", "ckdtangki", "ckdbbm", "sbatal",
    ],
    conflict: ["ckdtrm"],
    hasIngestedAt: true,
  },
  product: {
    table: "product",
    columns: ["ckdbbm", "vcnmbbm", "nhrgjual", "perk_map"],
    conflict: ["ckdbbm"],
    hasIngestedAt: false,
  },
  nozzle: {
    table: "nozzle",
    columns: ["ckdnozzle", "ckdpompa", "ckdtangki"],
    conflict: ["ckdnozzle"],
    hasIngestedAt: false,
  },
  tangki: {
    table: "tangki",
    columns: ["ckdtangki", "ckdbbm", "vcnmtangki"],
    conflict: ["ckdtangki"],
    hasIngestedAt: false,
  },
  account: {
    table: "account",
    columns: ["ckdperk", "vcnmperk", "ckdinduk"],
    conflict: ["ckdperk"],
    hasIngestedAt: false,
  },
  real_tank: {
    table: "real_tank",
    columns: [
      "ckdtangki", "nkapasitas", "ntinggi", "nvolume", "nsuhu",
      "ntinggiair", "nvolumeair", "nstatus", "dtanggaljam",
    ],
    conflict: ["ckdtangki"],
    hasIngestedAt: true,
  },

  // --- Rincian Penjualan (FASE 1b) ---
  // deposit: UPSERT by (unit_id, ckddepo); full-sync agent.
  deposit: {
    table: "deposit",
    columns: ["ckddepo", "dtgl", "ckdplg", "ntotal", "nsaldo", "sbatal", "vcket"],
    conflict: ["ckddepo"],
    hasIngestedAt: true,
    // Full-sync tiap cadence + material (12.444 baris hidup tapi 951.133 mati (98,7%)) → lihat skipUnchanged.
    skipUnchanged: true,
  },
  // card: master EDC, UPSERT by (unit_id, ckdcard).
  card: {
    table: "card",
    columns: ["ckdcard", "vcnmcard", "ckdbank", "cgl"],
    conflict: ["ckdcard"],
    hasIngestedAt: false,
  },
  // edc/pelanggan_sale/voucher_sale: REPLACE per (unit_id, business_date).
  // edc TAMBAH ON CONFLICT (kunci natural) di atas REPLACE → idempoten saat dua
  // /ingest BERSAMAAN (retry agent menimpa request yang masih commit): tanpa kunci
  // unik kedua DELETE tak melihat baris uncommitted lawan → keduanya INSERT → baris
  // kembar (insiden 2026-06-22). Kunci tervalidasi data-live (273k baris, 0 tabrakan
  // dgn NULLS NOT DISTINCT — ckdkartu/cnotrace sering NULL utk blank-card); index
  // fisik `edc_natural_key` NULLS NOT DISTINCT (migrasi 0012). DELETE tetap → koreksi
  // & buang baris usang. cshift+total WAJIB: baris blank-card lintas-shift identik
  // selain shift; total memisah pour sama-detik beda nominal.
  edc: {
    table: "edc",
    columns: [
      "business_date", "cshift", "tanggaljam", "ckdkartu", "total", "liter",
      "jenis", "cnotrace", "nonozle", "jrnkey",
    ],
    conflict: [
      "business_date", "cshift", "tanggaljam", "nonozle", "cnotrace",
      "ckdkartu", "total",
    ],
    hasIngestedAt: true,
    replaceByBusinessDate: true,
  },
  pelanggan_sale: {
    table: "pelanggan_sale",
    columns: [
      "business_date", "ckdplg", "vcnmplg", "ckdjualplg", "ckdbbm", "nshift",
      "liter", "total", "sbatal",
    ],
    conflict: [],
    hasIngestedAt: true,
    replaceByBusinessDate: true,
  },
  // tebus: Penebusan DO (tr_htebus ⋈ tr_dtebus). UPSERT by PK (idempoten saat
  // re-pull window). header by (unit_id,ckdtbs); detail by (unit_id,ckdtbs,ckdbbm).
  tebus_header: {
    table: "tebus_header",
    columns: ["ckdtbs", "dtgltbs", "cnoso", "sbatal"],
    conflict: ["ckdtbs"],
    hasIngestedAt: true,
  },
  tebus_detail: {
    table: "tebus_detail",
    columns: ["ckdtbs", "ckdbbm", "nvolume"],
    conflict: ["ckdtbs", "ckdbbm"],
    hasIngestedAt: true,
    sumOnConflict: ["nvolume"], // satu DO bisa menebus produk sama di >1 baris
  },
  // tera: Tera/kalibrasi nozzle (tabel `tera`). UPSERT by (unit_id, tanggaljam,
  // no_nozzle) — idempoten saat re-pull window. business_date & tanggaljam
  // ber-cast (date/timestamptz) via COLUMN_CAST (regresi 42804).
  tera: {
    table: "tera",
    columns: [
      "business_date", "tanggaljam", "no_nozzle", "id_pompa", "sa_tangki",
      "jenis", "ckdbbm", "liter", "total",
    ],
    conflict: ["tanggaljam", "no_nozzle"],
    hasIngestedAt: true,
    // Jaring: bila >1 pour ter-log di (tanggaljam, no_nozzle) sama dalam satu
    // batch → jumlahkan (volume tera tak hilang; Σ-per-produk benar). ON CONFLICT
    // tetap REPLACE antar-batch/re-pull → idempoten (pola tebus_detail).
    sumOnConflict: ["liter", "total"],
  },
  voucher_sale: {
    table: "voucher_sale",
    columns: [
      "business_date", "ckdplg", "vcnmplg", "ckdusevouc", "ckdbbm", "nshift",
      "liter", "total", "sbatal",
    ],
    conflict: [],
    hasIngestedAt: true,
    replaceByBusinessDate: true,
  },
  // terra_resmi: Tera RESMI (ledger tr_hterra ⋈ tr_dterra). Full-sync agent; UPSERT
  // by natural key (unit_id, ckdterra, ckdnozzle) → idempoten saat re-sync penuh
  // (REPLACE antar-siklus; tangkap koreksi/flip SBATAL). SUMBER TUNGGAL angka terra
  // laporan. business_date(::date)/dtgljam(::timestamptz) ber-cast via COLUMN_CAST.
  terra_resmi: {
    table: "terra_resmi",
    columns: [
      "business_date", "ckdterra", "ckdnozzle", "nshift", "ckdtangki",
      "ckdbbm", "nvolume", "nharga", "ntotal", "dtgljam", "ckdjualbbm", "sbatal",
    ],
    conflict: ["ckdterra", "ckdnozzle"],
    hasIngestedAt: true,
    // Full-sync tiap cadence + material (10.127 baris hidup tapi 762.102 mati (98,7%)) → lihat skipUnchanged.
    skipUnchanged: true,
    // Jaring multi-pour (defensif; EasyMax sudah konsolidasi per sesi×nozzle).
    sumOnConflict: ["nvolume", "ntotal"],
  },

  // --- Saldo Piutang/Hutang Pelanggan (FASE 1, RECAP) ---
  // bppiut/bphut: buku piutang/hutang (ledger). Full-sync agent; UPSERT by PK.
  bppiut: {
    table: "bppiut",
    columns: ["ckdbppiut", "dtgl", "ckdplg", "vcref", "vcket", "njumlah", "sjnsbp", "sbatal"],
    conflict: ["ckdbppiut"],
    hasIngestedAt: true,
    // Full-sync tiap cadence + material (ledger piutang, 2134 MB / 74% bangkai) → lihat skipUnchanged.
    skipUnchanged: true,
  },
  bphut: {
    table: "bphut",
    columns: ["ckdbphut", "dtgl", "ckdplg", "vcref", "vcket", "njumlah", "sjnsbp", "sbatal"],
    conflict: ["ckdbphut"],
    hasIngestedAt: true,
    // Full-sync tiap cadence + material (ledger hutang, 477 MB / 79,7% bangkai) → lihat skipUnchanged.
    skipUnchanged: true,
  },
  // pelanggan_master: master AR (tm_plg). SJENIS = diskriminator Lokal/Online.
  pelanggan_master: {
    table: "pelanggan_master",
    columns: ["ckdplg", "vcnmplg", "sjenis", "saktif"],
    conflict: ["ckdplg"],
    hasIngestedAt: false,
  },
};

/** Batas keras baris per tabel per request — sumber tunggal di @solamax/shared. */
export { MAX_ROWS_PER_TABLE } from "@solamax/shared";
