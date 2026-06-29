/**
 * FASE 0.5 — Probe READ-ONLY (gate sebelum Fase 1).
 *
 * 🔒 SELECT-only mutlak: setiap query lewat `conn.roQuery()` yang menegakkan
 *    assertSelectOnly() (db/readonly-guard.ts). Nol write/DDL. Tak mengirim ke backend.
 *    Pakai user `readonly_sync` (config.local.json). Salinan kanonik query yang
 *    DI-REVIEW = ../../FASE05-PROBE-QUERIES.sql (harus identik).
 *
 * Tujuan: tuntaskan 5 titik falsifikasi & rekon EKSAK ke PDF (unit 6478111),
 * minimal 2 tanggal. Target angka: ../../ADR-001-rincian-data-sources.md.
 *
 * Jalankan: `pnpm --filter @solamax/agent probe [YYYY-MM-DD ...]`
 *   (default tanggal: 2026-06-14 2026-06-17)
 */
import type { EasyMaxConnection } from "./db/mysql.js";

const DEFAULT_DATES = ["2026-06-14", "2026-06-17"];

/** Target rekonsiliasi dari PDF rincian manual (unit 6478111). Untuk dicetak di samping hasil. */
const EXPECTED: Record<string, Record<string, string>> = {
  "2026-06-14": {
    Pelanggan: "111.502.580 / 7.583,30 L (18 plg)",
    EDC: "90.974.097 (11 channel)",
    "Pendapatan Lain": "11.284.400 (manual)",
    "Pendapatan Non Tunai (deposit)": "(tak ada)",
    Pengeluaran: "300.000 (manual)",
  },
  "2026-06-17": {
    Pelanggan: "155.113.552 / 12.094,28 L (48 plg)",
    EDC: "116.565.499 (9 channel)",
    "Pendapatan Lain": "23.041.400 (manual)",
    "Pendapatan Non Tunai (deposit)": "47.000.000 (6 deposit)",
    Pengeluaran: "536.040 (manual)",
  },
};

function out(s = ""): void {
  process.stdout.write(s + "\n");
}

/** Cetak tabel hasil ringkas (header + baris). Aman utk nilai null/number/string. */
function printRows(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    out("  (0 baris)");
    return;
  }
  const cols = Object.keys(rows[0]!);
  out("  " + cols.join(" | "));
  for (const r of rows) {
    out("  " + cols.map((c) => fmt(r[c])).join(" | "));
  }
  if (rows.length >= 200) out(`  … (dipotong di ${rows.length} baris)`);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number") return v.toLocaleString("id-ID");
  return String(v);
}

function nextDay(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** Jalankan satu langkah probe: cetak label + SQL, eksekusi, cetak hasil/err. */
async function step(
  conn: EasyMaxConnection,
  label: string,
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<void> {
  out(`\n── ${label}`);
  out("  SQL: " + sql.replace(/\s+/g, " ").trim());
  if (params.length) out("  params: " + JSON.stringify(params));
  const t0 = Date.now();
  try {
    const rows = await conn.roQuery<Record<string, unknown>>(sql, params);
    out(`  ⏱ ${Date.now() - t0} ms`);
    printRows(rows);
  } catch (err) {
    out(`  ⏱ ${Date.now() - t0} ms`);
    out("  ⚠️ ERROR: " + String(err));
  }
}

export async function runProbe(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
  opts: { discoveryOnly?: boolean } = {},
): Promise<void> {
  const dates = datesArg.length ? datesArg : DEFAULT_DATES;
  out("==========================================================");
  out("FASE 0.5 PROBE (READ-ONLY) — unit 6478111");
  out(opts.discoveryOnly ? "mode: DISCOVERY SKEMA SAJA" : "tanggal: " + dates.join(", "));
  out("==========================================================");
  for (const d of dates) {
    if (EXPECTED[d]) {
      out(`\nTarget PDF ${d}:`);
      for (const [k, v] of Object.entries(EXPECTED[d]!)) out(`  ${k}: ${v}`);
    }
  }

  // ---- A. Discovery skema (DESCRIBE + sample) ----
  out("\n\n##### A. DISCOVERY SKEMA #####");
  for (const t of ["tr_edc", "tr_bppiut", "pjpelanggan", "pelanggan", "tr_deposit", "tr_hkasbank"]) {
    await step(conn, `DESCRIBE ${t}`, `DESCRIBE ${t}`);
    await step(conn, `sample ${t}`, `SELECT * FROM ${t} LIMIT 3`);
  }
  await step(conn, "DESCRIBE tm_card", "DESCRIBE tm_card");
  await step(conn, "dump tm_card (channel/QRIS)", "SELECT * FROM tm_card LIMIT 25");

  if (opts.discoveryOnly) {
    out("\n==========================================================");
    out("DISCOVERY SELESAI — BACA nama kolom REAL di atas dulu.");
    out("Bila beda dari asumsi (mis. SBATAL / Tanggaljam / TanggalJam casing),");
    out("sesuaikan FASE05-PROBE-QUERIES.sql + probe.ts SEBELUM jalankan P1–P6.");
    out("Lanjut: pnpm --filter @solamax/agent probe 2026-06-14 2026-06-17");
    out("==========================================================");
    return;
  }

  // ---- P3 (sekali, tak per-tanggal). Kas mati? ----
  out("\n\n##### P3. PENGELUARAN mati? (falsifikasi #3) #####");
  await step(
    conn,
    "tr_hkasbank rentang",
    "SELECT MIN(DTGL) AS mindtgl, MAX(DTGL) AS maxdtgl, COUNT(*) AS n FROM tr_hkasbank",
  );
  await step(
    conn,
    "tr_hkasbank baris 2026",
    "SELECT COUNT(*) AS n_2026 FROM tr_hkasbank WHERE DTGL >= '2026-01-01'",
  );
  await step(
    conn,
    "cari modul kas/pengeluaran",
    "SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(TABLE_NAME) LIKE '%kas%' OR LOWER(TABLE_NAME) LIKE '%biaya%' OR LOWER(TABLE_NAME) LIKE '%keluar%' OR LOWER(TABLE_NAME) LIKE '%pengeluaran%' OR LOWER(TABLE_NAME) LIKE '%expense%' OR LOWER(TABLE_NAME) LIKE '%bank%' ) ORDER BY TABLE_NAME",
  );

  // ---- P4 (sekali). PK unik tr_edc ----
  out("\n\n##### P4. PK unik tr_edc (falsifikasi #4) #####");
  await step(
    conn,
    "uniqueness tr_edc",
    "SELECT COUNT(*) AS total, COUNT(DISTINCT CNOTRACE) AS d_cnotrace, COUNT(DISTINCT CONCAT(CAST(Tanggaljam AS CHAR), '|', COALESCE(NoNozzle,''), '|', COALESCE(CNOTRACE,''))) AS d_composite, SUM(CASE WHEN CNOTRACE IS NULL OR CNOTRACE = '' THEN 1 ELSE 0 END) AS empty_cnotrace FROM tr_edc",
  );

  // ---- Per-tanggal: P1 (EDC), P2 (Pelanggan), P5 (business-date), P6 (Deposit) ----
  for (const date of dates) {
    const next = nextDay(date);
    out(`\n\n##### ===== TANGGAL ${date} ===== #####`);

    // P1 EDC ⊃ QRIS?
    out("\n### P1. EDC (falsifikasi #1) — cocokkan RUPIAH ke PDF");
    await step(
      conn,
      `EDC grand total ${date}`,
      "SELECT COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM tr_edc WHERE DATE(Tanggaljam) = ?",
      [date],
    );
    await step(
      conn,
      `EDC per kartu ${date}`,
      "SELECT e.CKDKARTU, COUNT(*) AS n, ROUND(SUM(e.Liter),2) AS liter, ROUND(SUM(e.TotalHarga),2) AS total FROM tr_edc e WHERE DATE(e.Tanggaljam) = ? GROUP BY e.CKDKARTU ORDER BY total DESC",
      [date],
    );

    // P2 Pelanggan — dua hipotesis
    out("\n### P2. PELANGGAN (falsifikasi #2) — cocokkan vol+Rp ke PDF");
    await step(
      conn,
      `H2a tr_bppiut per SJNSBP ${date}`,
      "SELECT SJNSBP, COUNT(*) AS n, ROUND(SUM(NJUMLAH),2) AS total FROM tr_bppiut WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0 GROUP BY SJNSBP ORDER BY SJNSBP",
      [date],
    );
    await step(
      conn,
      `H2a tr_bppiut per (SJNSBP,plg) ${date}`,
      "SELECT b.SJNSBP, b.CKDPLG, COUNT(*) AS n, ROUND(SUM(b.NJUMLAH),2) AS total FROM tr_bppiut b WHERE b.DTGL = ? AND COALESCE(b.SBATAL,0) = 0 GROUP BY b.SJNSBP, b.CKDPLG ORDER BY b.SJNSBP, total DESC",
      [date],
    );
    await step(
      conn,
      `H2b pjpelanggan grand ${date} (filter tanggal waras)`,
      "SELECT COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM pjpelanggan WHERE TanggalJam >= ? AND TanggalJam < ?",
      [date + " 00:00:00", next + " 00:00:00"],
    );
    await step(
      conn,
      `H2b pjpelanggan per IDCust ${date}`,
      "SELECT IDCust, COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM pjpelanggan WHERE TanggalJam >= ? AND TanggalJam < ? GROUP BY IDCust ORDER BY total DESC",
      [date + " 00:00:00", next + " 00:00:00"],
    );

    // P5 business-date spillover. Window MELEWATI tengah malam ke pagi :next
    // (s/d :next 06:00) supaya jam 00:00–06:00 hari :next ikut terlihat — itulah
    // tempat shift-3 :date bisa bocor. Gate utama tetap P1 (DATE() naif = PDF).
    out("\n### P5. Business-date EDC (falsifikasi #5)");
    await step(
      conn,
      `EDC distribusi per jam ${date} → pagi ${next}`,
      "SELECT DATE(Tanggaljam) AS d, HOUR(Tanggaljam) AS hr, COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total FROM tr_edc WHERE Tanggaljam >= ? AND Tanggaljam < ? GROUP BY DATE(Tanggaljam), HOUR(Tanggaljam) ORDER BY d, hr",
      [date + " 00:00:00", next + " 06:00:00"],
    );

    // P6 Deposit (Pendapatan Non Tunai)
    out("\n### P6. DEPOSIT / Pendapatan Non Tunai — konfirmasi tr_deposit");
    await step(
      conn,
      `deposit grand ${date}`,
      "SELECT COUNT(*) AS n, ROUND(SUM(NTOTAL),2) AS total FROM tr_deposit WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0",
      [date],
    );
    await step(
      conn,
      `deposit rincian ${date}`,
      "SELECT CKDDEPO, DTGL, CKDPLG, ROUND(NTOTAL,2) AS ntotal, ROUND(NSALDO,2) AS nsaldo, SBATAL FROM tr_deposit WHERE DTGL = ? ORDER BY NTOTAL DESC",
      [date],
    );
  }

  out("\n==========================================================");
  out("PROBE SELESAI — rekonsiliasi vs PDF di ADR-001. Tak ada data dikirim.");
  out("==========================================================");
}

/**
 * RONDE 2 (FASE05b) — tindak lanjut item GAGAL/INCONCLUSIVE ronde 1:
 *  R1 PK tr_edc (fix kolom NoNozle)
 *  R2 rule-out tr_bpbank / tr_dkasbank sbg modul kas 2026 (gate Pengeluaran)
 *  R3 EDC: business-date per shift penjualan + Jenis + settlement tr_trmedc
 *  R4 Pelanggan: master nama + lokasi 6 pelanggan hilang (deposit-draw?) + view
 * Semua tetap SELECT-only (roQuery → assertSelectOnly).
 */
export async function runProbe2(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length ? datesArg : DEFAULT_DATES;
  out("==========================================================");
  out("FASE 0.5b PROBE RONDE 2 (READ-ONLY) — unit 6478111");
  out("tanggal: " + dates.join(", "));
  out("==========================================================");

  // ---- R1. PK tr_edc (kolom benar: NoNozle) ----
  out("\n##### R1. PK unik tr_edc (kolom NoNozle) #####");
  await step(
    conn,
    "uniqueness tr_edc",
    "SELECT COUNT(*) AS total, COUNT(DISTINCT CNOTRACE) AS d_cnotrace, COUNT(DISTINCT CONCAT(CAST(TanggalJam AS CHAR), '|', COALESCE(NoNozle,''), '|', COALESCE(CNOTRACE,''))) AS d_composite, SUM(CASE WHEN CNOTRACE IS NULL OR CNOTRACE = '' THEN 1 ELSE 0 END) AS empty_cnotrace FROM tr_edc",
  );

  // ---- R2. Pengeluaran: rule-out tr_bpbank / tr_dkasbank ----
  out("\n##### R2. Modul kas pengganti? (gate Pengeluaran) #####");
  await step(conn, "DESCRIBE tr_bpbank", "DESCRIBE tr_bpbank");
  await step(conn, "sample tr_bpbank", "SELECT * FROM tr_bpbank LIMIT 5");
  await step(
    conn,
    "tr_bpbank rentang+2026 (asumsi kolom DTGL)",
    "SELECT MIN(DTGL) AS mn, MAX(DTGL) AS mx, COUNT(*) AS n, SUM(CASE WHEN DTGL >= '2026-01-01' THEN 1 ELSE 0 END) AS n2026 FROM tr_bpbank",
  );
  await step(conn, "DESCRIBE tr_dkasbank", "DESCRIBE tr_dkasbank");
  await step(
    conn,
    "tr_dkasbank via header 2026",
    "SELECT COUNT(*) AS n2026 FROM tr_dkasbank d JOIN tr_hkasbank h ON h.CKDKB = d.CKDKB WHERE h.DTGL >= '2026-01-01'",
  );

  // ---- R3. EDC: business-date per shift + Jenis + settlement ----
  out("\n##### R3. EDC sumber riil #####");
  await step(conn, "DESCRIBE tr_hjualbbm (shift)", "DESCRIBE tr_hjualbbm");
  await step(conn, "DESCRIBE tr_trmedc (settlement)", "DESCRIBE tr_trmedc");
  await step(conn, "tr_trmedc liveness", "SELECT COUNT(*) AS n FROM tr_trmedc");
  await step(
    conn,
    "view kandidat laporan harian (edc/jual/rekap/harian)",
    "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(TABLE_NAME) LIKE '%edc%' OR LOWER(TABLE_NAME) LIKE '%rekap%' OR LOWER(TABLE_NAME) LIKE '%harian%' OR LOWER(TABLE_NAME) LIKE '%daily%' OR LOWER(TABLE_NAME) LIKE '%setor%' ) ORDER BY TABLE_NAME",
  );

  for (const date of dates) {
    out(`\n### R3 EDC business-date ${date}`);
    await step(
      conn,
      `span DTGLJAM penjualan biz-day ${date}`,
      "SELECT h.NSHIFT, MIN(d.DTGLJAM) AS mn, MAX(d.DTGLJAM) AS mx, COUNT(*) AS n FROM tr_djualbbm d JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM WHERE h.DTGLJUAL = ? GROUP BY h.NSHIFT ORDER BY h.NSHIFT",
      [date],
    );
    await step(
      conn,
      `EDC dalam span penjualan biz-day ${date}`,
      "SELECT COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total FROM tr_edc WHERE TanggalJam >= (SELECT MIN(d.DTGLJAM) FROM tr_djualbbm d JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM WHERE h.DTGLJUAL = ?) AND TanggalJam <= (SELECT MAX(d.DTGLJAM) FROM tr_djualbbm d JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM WHERE h.DTGLJUAL = ?)",
      [date, date],
    );
    await step(
      conn,
      `EDC per Jenis ${date}`,
      "SELECT Jenis, COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total FROM tr_edc WHERE DATE(TanggalJam) = ? GROUP BY Jenis ORDER BY Jenis",
      [date],
    );
  }

  // ---- R4. Pelanggan: master nama + 6 pelanggan hilang + view ----
  out("\n##### R4. Pelanggan: master nama + sumber lengkap #####");
  await step(
    conn,
    "tabel kandidat master pelanggan",
    "SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(TABLE_NAME) LIKE '%pelang%' OR LOWER(TABLE_NAME) LIKE '%cust%' OR LOWER(TABLE_NAME) LIKE '%plg%' OR LOWER(TABLE_NAME) LIKE '%piut%' ) ORDER BY TABLE_NAME",
  );
  await step(
    conn,
    "kolom CKDPLG/nama lintas tabel",
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ( COLUMN_NAME LIKE '%CKDPLG%' OR COLUMN_NAME LIKE '%NMPLG%' OR COLUMN_NAME LIKE '%NAMAPLG%' OR COLUMN_NAME LIKE '%VCNMPLG%' ) ORDER BY TABLE_NAME, COLUMN_NAME",
  );

  for (const date of dates) {
    out(`\n### R4 Pelanggan ${date}`);
    // semua SJNSBP (bukan hanya non-batal) untuk lihat apakah ada jenis lain:
    await step(
      conn,
      `tr_bppiut semua SJNSBP×SBATAL ${date}`,
      "SELECT SJNSBP, SBATAL, COUNT(*) AS n, ROUND(SUM(NJUMLAH),2) AS total FROM tr_bppiut WHERE DTGL = ? GROUP BY SJNSBP, SBATAL ORDER BY SJNSBP, SBATAL",
      [date],
    );
    // apakah 6 pelanggan hilang = pelanggan deposit (sales draw-down deposit)?
    // deposit pelanggan dgn saldo aktif pada tanggal (indikatif):
    await step(
      conn,
      `tr_deposit semua (saldo) s/d ${date} — pelanggan ber-deposit`,
      "SELECT CKDPLG, ROUND(SUM(NTOTAL),2) AS total_topup, COUNT(*) AS n FROM tr_deposit WHERE DTGL <= ? AND COALESCE(SBATAL,0) = 0 GROUP BY CKDPLG ORDER BY total_topup DESC",
      [date],
    );
  }

  out("\n==========================================================");
  out("PROBE RONDE 2 SELESAI — analisis di ADR-001. Tak ada data dikirim.");
  out("==========================================================");
}

/**
 * RONDE 3 (FASE05c) — rekon sumber yang ditemukan ronde 2:
 *  S1 Pelanggan: tr_hjualplg/tr_djualplg (+tm_plg, vw_jualplg) → rekon vol+Rp+jumlah plg ke PDF
 *  S2 EDC: vw_edc/vw_edc2/vw_edc3 → cari view yang rekon ke PDF
 *  S3 PK EDC: JrnKey + komposit kaya
 *  S4 Pengeluaran: isi tr_bpbank pada tanggal (+lokasi "SETORAN BRIGHT")
 * Reconcile pakai kolom TEBAKAN (pola tr_*jualbbm) dalam try/catch — DESCRIBE+sample
 * tetap dicetak sebagai kebenaran; bila tebakan salah, perbaiki dari output.
 */
export async function runProbe3(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length ? datesArg : DEFAULT_DATES;
  out("==========================================================");
  out("FASE 0.5c PROBE RONDE 3 (READ-ONLY) — unit 6478111");
  out("tanggal: " + dates.join(", "));
  out("Target PDF Pelanggan: 14Jun 111.502.580/7.583,30L/18 · 17Jun 155.113.552/12.094,28L/48");
  out("Target PDF EDC: 14Jun 90.974.097/11ch · 17Jun 116.565.499/9ch");
  out("==========================================================");

  // ---- S1. Pelanggan: discovery + rekon ----
  out("\n##### S1. PELANGGAN — tr_hjualplg/tr_djualplg/tm_plg/vw_jualplg #####");
  for (const t of ["tr_hjualplg", "tr_djualplg", "tm_plg", "vw_jualplg"]) {
    await step(conn, `DESCRIBE ${t}`, `DESCRIBE ${t}`);
    await step(conn, `sample ${t}`, `SELECT * FROM ${t} LIMIT 3`);
  }
  for (const date of dates) {
    out(`\n### S1 rekon Pelanggan ${date}`);
    await step(
      conn,
      `grand (base tables, tebakan kolom) ${date}`,
      "SELECT COUNT(DISTINCT h.CKDPLG) AS plg, ROUND(SUM(d.NVOLUME),2) AS liter, ROUND(SUM(d.NSUBTOTAL),2) AS total FROM tr_djualplg d JOIN tr_hjualplg h ON h.CKDJUALPLG = d.CKDJUALPLG WHERE h.DTGLJUAL = ?",
      [date],
    );
    await step(
      conn,
      `per pelanggan (+nama) ${date}`,
      "SELECT h.CKDPLG, p.VCNMPLG, ROUND(SUM(d.NVOLUME),2) AS liter, ROUND(SUM(d.NSUBTOTAL),2) AS total FROM tr_djualplg d JOIN tr_hjualplg h ON h.CKDJUALPLG = d.CKDJUALPLG LEFT JOIN tm_plg p ON p.CKDPLG = h.CKDPLG WHERE h.DTGLJUAL = ? GROUP BY h.CKDPLG, p.VCNMPLG ORDER BY total DESC",
      [date],
    );
  }

  // ---- S2. EDC: views ----
  out("\n##### S2. EDC — vw_edc / vw_edc2 / vw_edc3 #####");
  for (const v of ["vw_edc", "vw_edc2", "vw_edc3"]) {
    await step(conn, `DESCRIBE ${v}`, `DESCRIBE ${v}`);
    await step(conn, `sample ${v}`, `SELECT * FROM ${v} LIMIT 5`);
  }
  for (const date of dates) {
    out(`\n### S2 rekon EDC view ${date}`);
    for (const v of ["vw_edc", "vw_edc2", "vw_edc3"]) {
      // dua tebakan kolom tanggal: TanggalJam (datetime) & DTGLJUAL (business date)
      await step(
        conn,
        `${v} by DATE(TanggalJam) ${date}`,
        `SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM ${v} WHERE DATE(TanggalJam) = ?`,
        [date],
      );
      await step(
        conn,
        `${v} by DTGLJUAL ${date}`,
        `SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM ${v} WHERE DTGLJUAL = ?`,
        [date],
      );
    }
  }

  // ---- S3. PK EDC: JrnKey + komposit kaya ----
  out("\n##### S3. PK EDC — JrnKey & komposit kaya #####");
  await step(
    conn,
    "uniqueness tr_edc (JrnKey/rich)",
    "SELECT COUNT(*) AS total, COUNT(DISTINCT JrnKey) AS d_jrnkey, COUNT(DISTINCT CONCAT(CAST(TanggalJam AS CHAR), '|', COALESCE(NoNozle,''), '|', COALESCE(CNOTRACE,''), '|', CAST(TotalHarga AS CHAR), '|', COALESCE(CKDKARTU,''))) AS d_rich, SUM(CASE WHEN JrnKey IS NULL THEN 1 ELSE 0 END) AS null_jrnkey FROM tr_edc",
  );

  // ---- S4. Pengeluaran: isi tr_bpbank pada tanggal + SETORAN BRIGHT ----
  out("\n##### S4. tr_bpbank isi pada tanggal (gate Pengeluaran + lokasi SETORAN BRIGHT) #####");
  for (const date of dates) {
    await step(
      conn,
      `tr_bpbank per SJNSBP ${date}`,
      "SELECT SJNSBP, COUNT(*) AS n, ROUND(SUM(NJUMLAH),2) AS total FROM tr_bpbank WHERE DTGL = ? GROUP BY SJNSBP ORDER BY SJNSBP",
      [date],
    );
    await step(
      conn,
      `tr_bpbank rincian ${date}`,
      "SELECT CKDBPBANK, CKDBANK, VCKET, ROUND(NJUMLAH,2) AS njumlah, SJNSBP, SBATAL FROM tr_bpbank WHERE DTGL = ? ORDER BY NJUMLAH DESC LIMIT 40",
      [date],
    );
  }

  out("\n==========================================================");
  out("PROBE RONDE 3 SELESAI — analisis di ADR-001. Tak ada data dikirim.");
  out("==========================================================");
}

/**
 * RONDE 3b (FASE05d) — rekon final dgn kolom yang sudah pasti:
 *  T1 Pelanggan: vw_jualplg by DTGL (Liter/TotalHarga/SBATAL) → rekon vol+Rp+jumlah plg
 *  T2 EDC: vw_edc3 by ctgl (business-date) + per kartu → rekon Rp+channel
 * Bila eksak di kedua tanggal → Pelanggan & EDC LULUS.
 */
export async function runProbe4(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length ? datesArg : DEFAULT_DATES;
  out("==========================================================");
  out("FASE 0.5d PROBE RONDE 3b (READ-ONLY) — unit 6478111");
  out("tanggal: " + dates.join(", "));
  out("Target Pelanggan: 14Jun 111.502.580/7.583,30L/18 · 17Jun 155.113.552/12.094,28L/48");
  out("Target EDC: 14Jun 90.974.097/11ch · 17Jun 116.565.499/9ch");
  out("==========================================================");

  for (const date of dates) {
    const ymd = date.replace(/-/g, "");
    out(`\n##### ===== TANGGAL ${date} (ctgl ${ymd}) ===== #####`);

    // T1 Pelanggan via vw_jualplg
    out("\n### T1. PELANGGAN — vw_jualplg by DTGL");
    await step(
      conn,
      `grand non-batal ${date}`,
      "SELECT COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM vw_jualplg WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0",
      [date],
    );
    await step(
      conn,
      `grand TANPA filter batal ${date} (pembanding)`,
      "SELECT COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM vw_jualplg WHERE DTGL = ?",
      [date],
    );
    await step(
      conn,
      `breakdown NTAGIH (tempo vs tunai?) ${date}`,
      "SELECT NTAGIH, COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total FROM vw_jualplg WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0 GROUP BY NTAGIH ORDER BY NTAGIH",
      [date],
    );
    await step(
      conn,
      `breakdown deposit-draw (CKDDEPO terisi) ${date}`,
      "SELECT CASE WHEN CKDDEPO IS NULL OR CKDDEPO = '' THEN 'no_depo' ELSE 'depo' END AS pakai_depo, COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total FROM vw_jualplg WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0 GROUP BY CASE WHEN CKDDEPO IS NULL OR CKDDEPO = '' THEN 'no_depo' ELSE 'depo' END",
      [date],
    );
    await step(
      conn,
      `per pelanggan (+nama) non-batal ${date}`,
      "SELECT CKDPLG, VCNMPLG, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM vw_jualplg WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0 GROUP BY CKDPLG, VCNMPLG ORDER BY total DESC",
      [date],
    );

    // T2 EDC via vw_edc3.ctgl
    out("\n### T2. EDC — vw_edc3 by ctgl (business-date)");
    await step(
      conn,
      `grand by ctgl ${ymd}`,
      "SELECT ROUND(SUM(TotalHarga),2) AS total, COUNT(*) AS n FROM vw_edc3 WHERE ctgl = ?",
      [ymd],
    );
    await step(
      conn,
      `per kartu (+nama) by ctgl ${ymd}`,
      "SELECT v.CKDKARTU, c.VCNMCARD, COUNT(*) AS n, ROUND(SUM(v.TotalHarga),2) AS total FROM vw_edc3 v LEFT JOIN tm_card c ON c.CKDCARD = v.CKDKARTU WHERE v.ctgl = ? GROUP BY v.CKDKARTU, c.VCNMCARD ORDER BY total DESC",
      [ymd],
    );
    await step(
      conn,
      `per cshift by ctgl ${ymd}`,
      "SELECT cshift, COUNT(*) AS n, ROUND(SUM(TotalHarga),2) AS total FROM vw_edc3 WHERE ctgl = ? GROUP BY cshift ORDER BY cshift",
      [ymd],
    );
  }

  out("\n==========================================================");
  out("PROBE RONDE 3b SELESAI — analisis di ADR-001. Tak ada data dikirim.");
  out("==========================================================");
}

/**
 * RONDE 3c (FASE05d2) — kunci query Pelanggan LENGKAP (EDC sudah LULUS):
 *  U1 vw_djlplg / vw_djlplg2 — apakah salah satunya = 18/48 langsung (sumber tunggal)?
 *  U2 union-extra: pelanggan di tr_bppiut yg TAK ada di vw_jualplg (count+Rp gap)
 *  U3 linkage tr_bppiut.VCREF → tr_hjualplg → tr_djualplg (sumber volume utk bppiut-only)
 */
export async function runProbe5(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length ? datesArg : DEFAULT_DATES;
  out("==========================================================");
  out("FASE 0.5d2 PROBE RONDE 3c (READ-ONLY) — Pelanggan lengkap");
  out("tanggal: " + dates.join(", "));
  out("Target: 14Jun 111.502.580/7.583,30L/18 · 17Jun 155.113.552/12.094,28L/48");
  out("==========================================================");

  // U1 — view daftar-jual-plg alternatif (mungkin sudah = laporan 18/48)
  out("\n##### U1. vw_djlplg / vw_djlplg2 #####");
  for (const v of ["vw_djlplg", "vw_djlplg2"]) {
    await step(conn, `DESCRIBE ${v}`, `DESCRIBE ${v}`);
    await step(conn, `sample ${v}`, `SELECT * FROM ${v} LIMIT 3`);
  }

  for (const date of dates) {
    out(`\n##### ===== TANGGAL ${date} ===== #####`);

    // U1 reconcile (tebakan kolom DTGL/Liter/TotalHarga/SBATAL/CKDPLG)
    for (const v of ["vw_djlplg", "vw_djlplg2"]) {
      await step(
        conn,
        `${v} grand by DTGL ${date}`,
        `SELECT COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM ${v} WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0`,
        [date],
      );
    }

    // U2 — extra customers di tr_bppiut yg tak ada di vw_jualplg
    out(`\n### U2. union-extra (bppiut not in jualplg) ${date}`);
    await step(
      conn,
      `extra count+Rp ${date}`,
      "SELECT COUNT(*) AS plg_extra, ROUND(SUM(b.t),2) AS total_extra FROM (SELECT CKDPLG, SUM(NJUMLAH) AS t FROM tr_bppiut WHERE DTGL = ? AND SJNSBP = 1 AND COALESCE(SBATAL,0) = 0 GROUP BY CKDPLG) b WHERE b.CKDPLG NOT IN (SELECT DISTINCT CKDPLG FROM vw_jualplg WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0)",
      [date, date],
    );

    // U3 — linkage VCREF → tr_hjualplg → tr_djualplg (sumber volume bppiut-only)
    out(`\n### U3. linkage bppiut→pjualplg (sumber volume) ${date}`);
    await step(
      conn,
      `bppiut + linked pjualplg detail ${date}`,
      "SELECT b.CKDPLG, b.VCREF, ROUND(b.NJUMLAH,2) AS njumlah, h.DTGL AS hdr_dtgl, ROUND(SUM(d.Liter),2) AS det_liter, ROUND(SUM(d.TotalHarga),2) AS det_total FROM tr_bppiut b LEFT JOIN tr_hjualplg h ON h.CKDJUALPLG = b.VCREF LEFT JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG WHERE b.DTGL = ? AND b.SJNSBP = 1 AND COALESCE(b.SBATAL,0) = 0 AND b.CKDPLG NOT IN (SELECT DISTINCT CKDPLG FROM vw_jualplg WHERE DTGL = ? AND COALESCE(SBATAL,0) = 0) GROUP BY b.CKDPLG, b.VCREF, b.NJUMLAH, h.DTGL ORDER BY njumlah DESC",
      [date, date],
    );
  }

  out("\n==========================================================");
  out("PROBE RONDE 3c SELESAI — analisis di ADR-001. Tak ada data dikirim.");
  out("==========================================================");
}

/**
 * RONDE 3d (FASE05e) — kunci sumber VOLUME penjualan voucher (tr_bppiut VCREF=UV).
 * Target volume gap 14 Jun: REHOBOT 670,95 / JNE 363,82 / INDOMARCO-kecil 57,79 / POL 11,35 = 1.103,91 L.
 * Cari tabel/view voucher + rekon per CKDPLG (vol+Rp) by tanggal bisnis.
 */
export async function runProbe6(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length ? datesArg : DEFAULT_DATES;
  out("==========================================================");
  out("FASE 0.5e PROBE RONDE 3d (READ-ONLY) — sumber volume voucher");
  out("tanggal: " + dates.join(", "));
  out("Gap volume 14 Jun: 1.103,91 L (REHOBOT 670,95/JNE 363,82/INDOMARCO 57,79/POL 11,35)");
  out("==========================================================");

  // V0 — daftar tabel/view voucher
  out("\n##### V0. tabel/view voucher #####");
  await step(
    conn,
    "cari tabel voucher",
    "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(TABLE_NAME) LIKE '%vouc%' OR LOWER(TABLE_NAME) LIKE '%usev%' OR LOWER(TABLE_NAME) LIKE '%tukar%' ) ORDER BY TABLE_NAME",
  );

  // V1 — discovery skema kandidat (try/catch; sebagian mungkin tak ada)
  out("\n##### V1. DESCRIBE + sample kandidat #####");
  for (const t of ["tr_husevouc", "tr_dusevouc", "tr_usevouc", "vw_usevouc"]) {
    await step(conn, `DESCRIBE ${t}`, `DESCRIBE ${t}`);
    await step(conn, `sample ${t}`, `SELECT * FROM ${t} LIMIT 3`);
  }

  // V2 — rekon per tanggal (tebakan kolom: DTGL / TanggalJam, Liter, TotalHarga, CKDPLG)
  for (const date of dates) {
    out(`\n### V2 rekon voucher ${date}`);
    await step(
      conn,
      `vw_usevouc by DTGL ${date}`,
      "SELECT CKDPLG, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM vw_usevouc WHERE DTGL = ? GROUP BY CKDPLG ORDER BY total DESC",
      [date],
    );
    await step(
      conn,
      `vw_usevouc by DATE(TanggalJam) ${date}`,
      "SELECT CKDPLG, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM vw_usevouc WHERE DATE(TanggalJam) = ? GROUP BY CKDPLG ORDER BY total DESC",
      [date],
    );
  }

  // V3 — linkage tr_bppiut.VCREF(UV) → voucher-use (tebakan kolom kunci utk join)
  out("\n##### V3. linkage tr_bppiut.VCREF(UV) → voucher #####");
  for (const date of dates) {
    await step(
      conn,
      `bppiut UV codes ${date}`,
      "SELECT b.CKDPLG, b.VCREF, ROUND(b.NJUMLAH,2) AS njumlah FROM tr_bppiut b WHERE b.DTGL = ? AND b.SJNSBP = 1 AND COALESCE(b.SBATAL,0) = 0 AND b.VCREF LIKE 'UV%' ORDER BY njumlah DESC",
      [date],
    );
  }

  out("\n==========================================================");
  out("PROBE RONDE 3d SELESAI — analisis di ADR-001. Tak ada data dikirim.");
  out("==========================================================");
}

/**
 * RONDE 3e (FASE05f) — pelanggan: (1) latensi vw_jualplg (view×2 vs base-table)
 * + korektness base = view per-tanggal 14–18; (2) isolasi delta 15 Jun
 * (per-pelanggan + jejak business-date≠dispense-date).
 */
export async function runProbe7(conn: EasyMaxConnection): Promise<void> {
  out("==========================================================");
  out("FASE 0.5f PROBE RONDE 3e — latensi vw_jualplg + base-table + delta 15 Jun");
  out("==========================================================");

  // L. LATENSI: view dijalankan 2× (cold vs warm), lalu base-table.
  out("\n##### L. LATENSI #####");
  const viewWindowSql =
    "SELECT COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS rp FROM vw_jualplg WHERE DTGL >= '2026-06-06' AND COALESCE(SBATAL,0) = 0";
  await step(conn, "vw_jualplg windowed (run-1 cold)", viewWindowSql);
  await step(conn, "vw_jualplg windowed (run-2 warm?)", viewWindowSql);
  await step(
    conn,
    "BASE tr_hjualplg⋈tr_djualplg windowed",
    "SELECT COUNT(*) AS n, ROUND(SUM(d.Liter),2) AS liter, ROUND(SUM(d.TotalHarga),2) AS rp FROM tr_hjualplg h LEFT JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG WHERE h.DTGL >= '2026-06-06' AND COALESCE(h.SBATAL,0) = 0",
  );

  // C. KOREKTNESS base = view, per tanggal 14–18 (harus identik).
  out("\n##### C. base vs view per-tanggal 14–18 (harus identik) #####");
  await step(
    conn,
    "per-tanggal VIEW",
    "SELECT DTGL, COUNT(DISTINCT CKDPLG) AS plg, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS rp FROM vw_jualplg WHERE DTGL BETWEEN '2026-06-14' AND '2026-06-18' AND COALESCE(SBATAL,0) = 0 GROUP BY DTGL ORDER BY DTGL",
  );
  await step(
    conn,
    "per-tanggal BASE",
    "SELECT h.DTGL, COUNT(DISTINCT h.CKDPLG) AS plg, ROUND(SUM(d.Liter),2) AS liter, ROUND(SUM(d.TotalHarga),2) AS rp FROM tr_hjualplg h LEFT JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG WHERE h.DTGL BETWEEN '2026-06-14' AND '2026-06-18' AND COALESCE(h.SBATAL,0) = 0 GROUP BY h.DTGL ORDER BY h.DTGL",
  );

  // D. DELTA 15 Jun: per-pelanggan (base) + voucher + jejak telat.
  out("\n##### D. delta 15 Jun (PDF 148.157.618 / 12.279,03 L / 39) #####");
  await step(
    conn,
    "15-Jun per-pelanggan SALE (base, +nama)",
    "SELECT h.CKDPLG, p.VCNMPLG, ROUND(SUM(d.Liter),2) AS liter, ROUND(SUM(d.TotalHarga),2) AS rp FROM tr_hjualplg h LEFT JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG LEFT JOIN tm_plg p ON p.CKDPLG = h.CKDPLG WHERE h.DTGL = '2026-06-15' AND COALESCE(h.SBATAL,0) = 0 GROUP BY h.CKDPLG, p.VCNMPLG ORDER BY rp DESC",
  );
  await step(
    conn,
    "15-Jun per-pelanggan VOUCHER",
    "SELECT CKDPLG, VCNMPLG, ROUND(SUM(liter),2) AS liter, ROUND(SUM(NJUMLAHUSE),2) AS rp FROM vw_usevouc WHERE DTGL = '2026-06-15' AND COALESCE(SBATAL,0) = 0 GROUP BY CKDPLG, VCNMPLG ORDER BY rp DESC",
  );
  await step(
    conn,
    "15-Jun jejak telat (business-date 15/6 tapi dispense-date ≠ 15/6, sane)",
    "SELECT h.CKDPLG, p.VCNMPLG, h.CKDJUALPLG, d.TanggalJam, d.CKDBBM, ROUND(d.Liter,2) AS liter, ROUND(d.TotalHarga,2) AS rp FROM tr_hjualplg h JOIN tr_djualplg d ON d.CKDJUALPLG = h.CKDJUALPLG LEFT JOIN tm_plg p ON p.CKDPLG = h.CKDPLG WHERE h.DTGL = '2026-06-15' AND COALESCE(h.SBATAL,0) = 0 AND d.TanggalJam >= '2026-06-15' AND d.TanggalJam < '2026-07-01' AND DATE(d.TanggalJam) <> '2026-06-15' ORDER BY d.TanggalJam",
  );

  out("\n==========================================================");
  out("PROBE RONDE 3e SELESAI — analisis di ADR-001. Tak ada data dikirim.");
  out("==========================================================");
}

/**
 * FASE 0.5g — diagnosa LOCK go-live (MyISAM concurrent-insert). Pertanyaan: apakah
 * SELECT pelanggan (~12s) BENAR memblok INSERT pompa di `tr_djualplg`? Di MyISAM,
 * concurrent_insert mengizinkan INSERT di akhir tabel BERSAMAAN dgn SELECT ASAL
 * tak ada "lubang" (Data_free=0). EasyMax flag-cancel (bukan hard-delete) → mungkin
 * tanpa lubang → lock MOOT. SELECT/SHOW only (read-only mutlak).
 */
/**
 * FASE 1 (Omset gap) — rekon EasyMax SALES per business-date (DTGLJUAL) vs PDF.
 * Tujuan: konfirmasi EasyMax LENGKAP (= PDF) sementara staging kurang → buktikan
 * masalah = sync stale, bukan sumber. Read-only (base-table InnoDB, ter-bound 5 hari).
 * Default 14–18 Jun 2026. Bandingkan SUM(NSUBTOTAL) ke PDF Omset + lokalisasi per shift
 * + hitung baris ter-edit (SUBAH/SEDIT) yang TAK tertangkap incremental DTGLJAM>watermark.
 */
const PDF_OMSET: Record<string, number> = {
  "2026-06-14": 446_624_181,
  "2026-06-15": 687_620_353,
  "2026-06-16": 432_932_094,
  "2026-06-17": 633_583_515,
  "2026-06-18": 415_858_747,
};

export async function runProbe9(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length ? datesArg : Object.keys(PDF_OMSET);
  const lo = dates[0]!;
  const hiNext = nextDay(dates[dates.length - 1]!);
  out("==========================================================");
  out("FASE 1 PROBE — rekon SALES EasyMax per DTGLJUAL vs PDF (Omset gap)");
  out("rentang: " + lo + " .. " + dates[dates.length - 1] + "  (PDF di kanan)");
  out("==========================================================");

  // P1 — grand total per business-date: COUNT detail + SUM(NSUBTOTAL).
  await step(
    conn,
    "P1. per DTGLJUAL: n_header, n_detail, SUM(NSUBTOTAL)",
    `SELECT h.DTGLJUAL,
            COUNT(DISTINCT h.CKDJUALBBM) AS n_header,
            COUNT(*)                     AS n_detail,
            ROUND(SUM(d.NSUBTOTAL),0)    AS omset
     FROM tr_hjualbbm h
     JOIN tr_djualbbm d ON d.CKDJUALBBM = h.CKDJUALBBM
     WHERE h.DTGLJUAL >= ? AND h.DTGLJUAL < ?
     GROUP BY h.DTGLJUAL ORDER BY h.DTGLJUAL`,
    [lo, hiNext],
  );

  // P2 — per shift: lokalisasi DI MANA staging kurang (mis. 15 Jun shift 2/3).
  await step(
    conn,
    "P2. per DTGLJUAL × NSHIFT: n_detail, SUM, MAX(DTGLJAM)",
    `SELECT h.DTGLJUAL, h.NSHIFT,
            COUNT(*) AS n_detail,
            ROUND(SUM(d.NSUBTOTAL),0) AS omset,
            MAX(d.DTGLJAM) AS last_ts
     FROM tr_hjualbbm h
     JOIN tr_djualbbm d ON d.CKDJUALBBM = h.CKDJUALBBM
     WHERE h.DTGLJUAL >= ? AND h.DTGLJUAL < ?
     GROUP BY h.DTGLJUAL, h.NSHIFT ORDER BY h.DTGLJUAL, h.NSHIFT`,
    [lo, hiNext],
  );

  // P3 — baris ter-EDIT (SUBAH/SEDIT) per hari: koreksi pasca-tulis yang TIDAK
  // tertangkap incremental (DTGLJAM lama < watermark) → akar selisih hari "penuh".
  await step(
    conn,
    "P3. per DTGLJUAL: jumlah baris SUBAH=1 / SEDIT=1 (koreksi)",
    `SELECT h.DTGLJUAL,
            SUM(CASE WHEN d.SUBAH = 1 THEN 1 ELSE 0 END) AS n_subah,
            SUM(CASE WHEN d.SEDIT = 1 THEN 1 ELSE 0 END) AS n_sedit
     FROM tr_hjualbbm h
     JOIN tr_djualbbm d ON d.CKDJUALBBM = h.CKDJUALBBM
     WHERE h.DTGLJUAL >= ? AND h.DTGLJUAL < ?
     GROUP BY h.DTGLJUAL ORDER BY h.DTGLJUAL`,
    [lo, hiNext],
  );

  // ---- Interpretasi terprogram: EasyMax vs PDF ----
  out("\n##### INTERPRETASI (EasyMax vs PDF) #####");
  const grand = await conn.roQuery<Record<string, unknown>>(
    `SELECT h.DTGLJUAL AS d, ROUND(SUM(d.NSUBTOTAL),0) AS omset
     FROM tr_hjualbbm h JOIN tr_djualbbm d ON d.CKDJUALBBM = h.CKDJUALBBM
     WHERE h.DTGLJUAL >= ? AND h.DTGLJUAL < ?
     GROUP BY h.DTGLJUAL ORDER BY h.DTGLJUAL`,
    [lo, hiNext],
  );
  out("  tgl        | easymax        | pdf            | selisih (easymax−pdf)");
  for (const r of grand) {
    const d = String(r.d).slice(0, 10);
    const em = Number(r.omset);
    const pdf = PDF_OMSET[d];
    const diff = pdf === undefined ? NaN : em - pdf;
    const verdict =
      pdf === undefined
        ? "(tanpa PDF)"
        : diff === 0
          ? "✅ EKSAK = PDF"
          : `Δ ${diff.toLocaleString("id-ID")}`;
    out(
      `  ${d} | ${em.toLocaleString("id-ID").padStart(14)} | ${(pdf ?? 0).toLocaleString("id-ID").padStart(14)} | ${verdict}`,
    );
  }
  out("\n  Jika EasyMax = PDF (semua hari) → sumber LENGKAP; gap murni di staging");
  out("  (sync sales stale). Rencana: re-backfill bounded per DTGLJUAL (UPSERT idempoten).");

  out("\n==========================================================");
  out("PROBE FASE 1 SELESAI — read-only, tak ada data dikirim/ditulis.");
  out("==========================================================");
}

/**
 * FASE FINAL — GOLD CHECK: total EasyMax-KINI per seksi auto-sync per tanggal,
 * memakai SUMBER & predikat IDENTIK dgn yang disinkronkan agent (Omset tanpa filter
 * DTGLJAM; Pelanggan union non-batal; EDC excl blank-card + blank terpisah; Deposit
 * non-batal). Dion jalankan → bandingkan EKSAK ke recon staging. Sama = sync setia
 * (UPSERT idempoten); beda = gap nyata. Read-only mutlak.
 */
export async function runProbe10(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length
    ? datesArg
    : ["2026-06-14", "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"];
  const lo = dates[0]!;
  const hi = dates[dates.length - 1]!;
  const hiNext = nextDay(hi); // batas atas eksklusif utk kolom DATE
  const ctglLo = lo.replace(/-/g, "");
  const ctglHi = hi.replace(/-/g, "");
  out("==========================================================");
  out("FASE FINAL GOLD CHECK — total EasyMax-kini per seksi per tanggal");
  out("rentang: " + lo + " .. " + hi + "  → bandingkan EKSAK ke recon staging");
  out("==========================================================");

  await step(
    conn,
    "OMSET — SUM(NSUBTOTAL) per DTGLJUAL (tanpa filter DTGLJAM, = staging)",
    `SELECT h.DTGLJUAL, ROUND(SUM(d.NSUBTOTAL),1) AS omset, COUNT(*) AS n
     FROM tr_hjualbbm h JOIN tr_djualbbm d ON d.CKDJUALBBM = h.CKDJUALBBM
     WHERE h.DTGLJUAL >= ? AND h.DTGLJUAL < ?
     GROUP BY h.DTGLJUAL ORDER BY h.DTGLJUAL`,
    [lo, hiNext],
  );

  await step(
    conn,
    "PELANGGAN — union vw_jualplg ⊎ vw_usevouc, SUM per DTGL (non-batal)",
    `SELECT DTGL, ROUND(SUM(t),0) AS pelanggan FROM (
        SELECT DTGL, TotalHarga AS t, SBATAL FROM vw_jualplg WHERE DTGL >= ? AND DTGL < ?
        UNION ALL
        SELECT DTGL, NJUMLAHUSE AS t, SBATAL FROM vw_usevouc WHERE DTGL >= ? AND DTGL < ?
     ) u WHERE COALESCE(SBATAL,0) = 0 GROUP BY DTGL ORDER BY DTGL`,
    [lo, hiNext, lo, hiNext],
  );

  await step(
    conn,
    "EDC non-blank — SUM(TotalHarga) per ctgl (CKDKARTU<>'')",
    `SELECT ctgl, ROUND(SUM(TotalHarga),0) AS edc, COUNT(*) AS n
     FROM vw_edc3 WHERE ctgl >= ? AND ctgl <= ? AND CKDKARTU IS NOT NULL AND CKDKARTU <> ''
     GROUP BY ctgl ORDER BY ctgl`,
    [ctglLo, ctglHi],
  );
  await step(
    conn,
    "EDC BLANK-CARD — SUM per ctgl (kepatuhan; harus terpisah)",
    `SELECT ctgl, ROUND(SUM(TotalHarga),0) AS blank, COUNT(*) AS n
     FROM vw_edc3 WHERE ctgl >= ? AND ctgl <= ? AND (CKDKARTU IS NULL OR CKDKARTU = '')
     GROUP BY ctgl ORDER BY ctgl`,
    [ctglLo, ctglHi],
  );

  await step(
    conn,
    "DEPOSIT — SUM(NTOTAL) per DTGL (non-batal)",
    `SELECT DTGL, ROUND(SUM(NTOTAL),0) AS deposit, COUNT(*) AS n
     FROM tr_deposit WHERE DTGL >= ? AND DTGL < ? AND COALESCE(SBATAL,0) = 0
     GROUP BY DTGL ORDER BY DTGL`,
    [lo, hiNext],
  );

  out("\n==========================================================");
  out("GOLD CHECK SELESAI — read-only. Bandingkan tiap sel ke recon staging:");
  out("  sama EKSAK → sync setia (UPSERT idempoten); beda → gap nyata, diagnosa.");
  out("==========================================================");
}

export async function runProbe8(conn: EasyMaxConnection): Promise<void> {
  out("==========================================================");
  out("FASE 0.5g PROBE — lock go-live (MyISAM concurrent_insert + Data_free)");
  out("==========================================================");

  await step(conn, "concurrent_insert", "SHOW VARIABLES LIKE 'concurrent_insert'");
  await step(conn, "status tr_djualplg", "SHOW TABLE STATUS LIKE 'tr_djualplg'");
  await step(conn, "status tr_hjualplg", "SHOW TABLE STATUS LIKE 'tr_hjualplg'");

  // ---- Interpretasi terprogram ----
  const ci = await conn.roQuery<Record<string, unknown>>(
    "SHOW VARIABLES LIKE 'concurrent_insert'",
  );
  const ciVal = ci[0] ? String(ci[0].Value).toUpperCase() : "?";
  const allows = ["1", "2", "AUTO", "ALWAYS"].includes(ciVal);
  const always = ciVal === "2" || ciVal === "ALWAYS";

  out("\n##### INTERPRETASI (lock-gate go-live) #####");
  for (const t of ["tr_djualplg", "tr_hjualplg"]) {
    const st = await conn.roQuery<Record<string, unknown>>(
      `SHOW TABLE STATUS LIKE '${t}'`,
    );
    const r = st[0];
    if (!r) {
      out(`  ${t}: (status tak ditemukan)`);
      continue;
    }
    const engine = String(r.Engine ?? "?");
    const dataFree = Number(r.Data_free ?? NaN);
    out(`  ${t}: Engine=${engine} · Data_free=${dataFree} · concurrent_insert=${ciVal}`);
    let verdict: string;
    if (engine.toUpperCase() !== "MYISAM") {
      verdict = `→ Bukan MyISAM (${engine}) → SELECT tak table-lock → LOCK-GATE MOOT (CLOSED).`;
    } else if (always) {
      verdict = "→ concurrent_insert=ALWAYS → append jalan walau ada lubang → CLOSED.";
    } else if (allows && dataFree === 0) {
      verdict =
        "→ concurrent_insert aktif + Data_free=0 (tanpa lubang) → SELECT TAK blok append-INSERT → CLOSED (window+interval cukup).";
    } else if (allows && dataFree > 0) {
      verdict =
        "→ ada lubang (Data_free>0) → concurrent insert MATI utk tabel ini → SELECT blok INSERT → BLOCKING NYATA → pertahankan window 3d + interval 15–30 mnt / off-peak.";
    } else {
      verdict =
        "→ concurrent_insert=NEVER/0 → tak ada concurrent append → BLOCKING NYATA → interval lebar / off-peak.";
    }
    out(`    ${verdict}`);
  }
  out("\n  Keputusan dicatat di FASE1-PLAN (go-live lock gate).");

  out("\n==========================================================");
  out("PROBE FASE 0.5g SELESAI — tak ada data dikirim / ditulis (read-only).");
  out("==========================================================");
}

/** Oracle Saldo (Nominal Rp) dari PDF "Laporan Penjualan Harian" IB — utk dicocokkan. */
const SALDO_EXPECTED: Record<string, { piutangLokal: string; piutangOnline: string; hutangLokal: string }> = {
  "2026-06-17": { piutangLokal: "50.835.447.684", piutangOnline: "1.200.000", hutangLokal: "(711.193.196)" },
  "2026-06-18": { piutangLokal: "50.904.293.353", piutangOnline: "1.200.000", hutangLokal: "(671.925.313)" },
  "2026-06-19": { piutangLokal: "50.904.293.353", piutangOnline: "1.200.000", hutangLokal: "(671.925.313)" },
  "2026-06-21": { piutangLokal: "51.073.347.621", piutangOnline: "1.200.000", hutangLokal: "(662.004.309)" },
  "2026-06-22": { piutangLokal: "51.187.386.591", piutangOnline: "1.200.000", hutangLokal: "(641.185.809)" },
  "2026-06-23": { piutangLokal: "51.264.863.800", piutangOnline: "1.200.000", hutangLokal: "(662.243.136)" },
  "2026-06-24": { piutangLokal: "51.427.912.799", piutangOnline: "1.200.000", hutangLokal: "(691.311.547)" },
  "2026-06-26": { piutangLokal: "51.544.752.814", piutangOnline: "1.200.000", hutangLokal: "(641.452.669)" },
  "2026-06-27": { piutangLokal: "51.608.248.203", piutangOnline: "1.200.000", hutangLokal: "(642.244.312)" },
};

/**
 * RONDE 11 (FASE 1 — SALDO) — kunci 3 baris Saldo blok RECAP HARIAN, READ-ONLY:
 *   A. Discovery master `pelanggan` — TEMUKAN diskriminator Lokal/Online + kolom saldo (jangan tebak).
 *   B. PIUTANG `tr_bppiut` — tanda SJNSBP (debit/kredit) → saldo kumulatif as-of per tanggal,
 *      lalu identifikasi pelanggan Online secara EMPIRIS (saldo flat 1.200.000) + dump master-nya
 *      vs pelanggan Lokal besar → diskriminator terbukti dari data.
 *   C. HUTANG (liabilitas deposit) — uji 3 hipotesis: (C1) kolom saldo master, (C2) `tr_deposit.NSALDO`
 *      baris terakhir per pelanggan as-of, (C3) ledger Σtop-up − Σtarik (deposit-draw vw_jualplg).
 *      Yang mendarat di oracle Hutang = sumber benar.
 * Cocokkan ke SALDO_EXPECTED. MySQL 5.0.67-safe (tanpa CTE/window). Nol write/kirim.
 */
export async function runProbe11(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length
    ? datesArg
    : ["2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-21",
       "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-26", "2026-06-27"];
  out("==========================================================");
  out("FASE 1 PROBE RONDE 11 (READ-ONLY) — SALDO Piutang/Hutang · unit 6478111");
  out("tanggal: " + dates.join(", "));
  out("==========================================================");
  out("\nTarget oracle Saldo (Nominal Rp) — PDF Laporan Penjualan Harian IB:");
  out("  tgl | Piutang Lokal | Piutang Online | Hutang Lokal");
  for (const d of dates) {
    const e = SALDO_EXPECTED[d];
    if (e) out(`  ${d} | ${e.piutangLokal} | ${e.piutangOnline} | ${e.hutangLokal}`);
  }

  // ===== A. DISCOVERY master `pelanggan` (diskriminator + kolom saldo) =====
  out("\n\n##### A. DISCOVERY master `pelanggan` #####");
  await step(
    conn,
    "A1 kolom pelanggan",
    "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pelanggan' ORDER BY ORDINAL_POSITION",
  );
  await step(conn, "A2 sample pelanggan", "SELECT * FROM pelanggan LIMIT 5");
  await step(
    conn,
    "A3 kandidat kolom flag Lokal/Online (by nama)",
    "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pelanggan' AND ( LOWER(COLUMN_NAME) LIKE '%online%' OR LOWER(COLUMN_NAME) LIKE '%jenis%' OR LOWER(COLUMN_NAME) LIKE '%jns%' OR LOWER(COLUMN_NAME) LIKE '%tipe%' OR LOWER(COLUMN_NAME) LIKE '%type%' OR LOWER(COLUMN_NAME) LIKE '%group%' OR LOWER(COLUMN_NAME) LIKE '%grup%' OR LOWER(COLUMN_NAME) LIKE '%kelompok%' OR LOWER(COLUMN_NAME) LIKE '%kategori%' OR LOWER(COLUMN_NAME) LIKE '%lokal%' OR LOWER(COLUMN_NAME) LIKE '%gol%' ) ORDER BY COLUMN_NAME",
  );
  await step(
    conn,
    "A4 kandidat kolom saldo/limit (by nama)",
    "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pelanggan' AND ( LOWER(COLUMN_NAME) LIKE '%saldo%' OR LOWER(COLUMN_NAME) LIKE '%depo%' OR LOWER(COLUMN_NAME) LIKE '%piut%' OR LOWER(COLUMN_NAME) LIKE '%plafon%' OR LOWER(COLUMN_NAME) LIKE '%limit%' OR LOWER(COLUMN_NAME) LIKE '%tagih%' OR LOWER(COLUMN_NAME) LIKE '%hutang%' ) ORDER BY COLUMN_NAME",
  );
  await step(conn, "A5 DESCRIBE tr_bppiut", "DESCRIBE tr_bppiut");
  await step(conn, "A5 DESCRIBE tr_deposit", "DESCRIBE tr_deposit");

  // ===== B. PIUTANG (tr_bppiut) — tanda SJNSBP + saldo as-of + ID Online empiris =====
  out("\n\n##### B. PIUTANG — tr_bppiut (SJNSBP=jenis debit/kredit) #####");
  await step(
    conn,
    "B1 domain SJNSBP (kumulatif s/d 2026-06-27, non-batal) — tentukan tanda",
    "SELECT SJNSBP, COUNT(*) AS n, ROUND(SUM(NJUMLAH),2) AS total_raw FROM tr_bppiut WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= '2026-06-27' GROUP BY SJNSBP ORDER BY SJNSBP",
  );
  out("\n### B2. Saldo PIUTANG kumulatif as-of per tanggal (per SJNSBP → saya tanda-i & jumlahkan; cocokkan ke Lokal+Online)");
  for (const date of dates) {
    await step(
      conn,
      `B2 kumulatif (asof,SJNSBP) ≤ ${date}`,
      "SELECT SJNSBP, ROUND(SUM(NJUMLAH),2) AS total_raw, COUNT(*) AS n FROM tr_bppiut WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= ? GROUP BY SJNSBP ORDER BY SJNSBP",
      [date],
    );
  }
  out("\n### B3. Identifikasi pelanggan ONLINE secara EMPIRIS (saldo kecil/flat ~1.200.000) + dump master");
  await step(
    conn,
    "B3a saldo per pelanggan as-of 2026-06-18 (saldo kecil 1..10jt → kandidat Online)",
    "SELECT b.CKDPLG, p.VCNMPLG, ROUND(SUM(b.NJUMLAH),2) AS saldo_raw, COUNT(*) AS n FROM tr_bppiut b LEFT JOIN pelanggan p ON p.CKDPLG = b.CKDPLG WHERE COALESCE(b.SBATAL,0) = 0 AND b.DTGL <= '2026-06-18' GROUP BY b.CKDPLG, p.VCNMPLG HAVING ABS(saldo_raw) BETWEEN 1 AND 10000000 ORDER BY saldo_raw LIMIT 60",
  );
  await step(
    conn,
    "B3b DUMP master pelanggan ber-saldo kecil (1..5jt) as-of 18 — lihat flag yang menandai Online",
    "SELECT p.* FROM pelanggan p WHERE p.CKDPLG IN ( SELECT b.CKDPLG FROM tr_bppiut b WHERE COALESCE(b.SBATAL,0) = 0 AND b.DTGL <= '2026-06-18' GROUP BY b.CKDPLG HAVING ROUND(SUM(b.NJUMLAH),2) BETWEEN 1 AND 5000000 )",
  );
  await step(
    conn,
    "B3c DUMP master pelanggan ber-saldo BESAR (>1 miliar) as-of 18 — kontras flag (Lokal)",
    "SELECT p.* FROM pelanggan p WHERE p.CKDPLG IN ( SELECT b.CKDPLG FROM tr_bppiut b WHERE COALESCE(b.SBATAL,0) = 0 AND b.DTGL <= '2026-06-18' GROUP BY b.CKDPLG HAVING ROUND(SUM(b.NJUMLAH),2) > 1000000000 )",
  );

  // ===== C. HUTANG (liabilitas deposit) — 3 hipotesis =====
  out("\n\n##### C. HUTANG — liabilitas deposit (uji 3 hipotesis vs oracle) #####");
  await step(
    conn,
    "C1 struktur tr_deposit: ada baris negatif (tarik) atau hanya top-up? (kumulatif s/d 27)",
    "SELECT (NTOTAL >= 0) AS is_positif, COUNT(*) AS n, ROUND(SUM(NTOTAL),2) AS total FROM tr_deposit WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= '2026-06-27' GROUP BY (NTOTAL >= 0)",
  );
  out("\n### C2. tr_deposit.NSALDO — baris TERAKHIR per pelanggan as-of (Σ) → cocokkan ke Hutang");
  for (const date of dates) {
    await step(
      conn,
      `C2 Σ NSALDO terakhir/pelanggan ≤ ${date}`,
      "SELECT ROUND(SUM(t.NSALDO),2) AS hutang_nsaldo, COUNT(*) AS ncust FROM tr_deposit t WHERE COALESCE(t.SBATAL,0) = 0 AND t.DTGL <= ? AND t.CKDDEPO = ( SELECT t2.CKDDEPO FROM tr_deposit t2 WHERE t2.CKDPLG = t.CKDPLG AND COALESCE(t2.SBATAL,0) = 0 AND t2.DTGL <= ? ORDER BY t2.DTGL DESC, t2.CKDDEPO DESC LIMIT 1 )",
      [date, date],
    );
  }
  out("\n### C3. Ledger Σtop-up − Σtarik (deposit-draw via vw_jualplg.CKDDEPO) as-of → cocokkan ke Hutang");
  for (const date of dates) {
    await step(
      conn,
      `C3 top-up/tarik/saldo ≤ ${date}`,
      "SELECT ( SELECT ROUND(SUM(NTOTAL),2) FROM tr_deposit WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= ? ) AS topup_kumulatif, ( SELECT ROUND(SUM(TotalHarga),2) FROM vw_jualplg WHERE COALESCE(SBATAL,0) = 0 AND CKDDEPO IS NOT NULL AND CKDDEPO <> '' AND DTGL <= ? ) AS tarik_kumulatif",
      [date, date],
    );
  }
  out("  (Catatan: bila C3 tak landing, tambah penarikan deposit dari voucher/seksi lain — lihat vw_usevouc.CKDDEPO.)");

  out("\n==========================================================");
  out("PROBE RONDE 11 SELESAI — read-only, nol kirim. Tempel output: saya kunci");
  out("formula tiap baris Saldo ke oracle untuk SEMUA tanggal lalu lanjut Fase 2.");
  out("==========================================================");
}

/**
 * RONDE 12 (FASE 1 — SALDO, KOREKSI) — perbaiki ronde 11:
 *   - Master AR yang benar = `tm_plg` (CKDPLG/VCNMPLG), BUKAN `pelanggan` (itu tabel kartu
 *     RFID/kuota ber-IDKartu). Diskriminator Lokal/Online di `tm_plg`.
 *   - PIUTANG bukan kumulatif mentah: model PER-PELANGGAN (net signed; uji clamp ≥0) +
 *     cek kolom saldo terpelihara di tm_plg → cocokkan ke oracle.
 *   - HUTANG: buang NSALDO (sampah + lambat). Pakai ledger Σtop-up − Σtarik (cepat),
 *     level total & per-pelanggan (clamp ≥0).
 * MySQL 5.0.67-safe. Nol write/kirim.
 */
export async function runProbe12(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length
    ? datesArg
    : ["2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-21",
       "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-26", "2026-06-27"];
  out("==========================================================");
  out("FASE 1 PROBE RONDE 12 (READ-ONLY, KOREKSI) — SALDO · unit 6478111");
  out("tanggal: " + dates.join(", "));
  out("==========================================================");
  out("\nTarget oracle (Rp): Piutang Lokal | Online | Hutang Lokal");
  for (const d of dates) {
    const e = SALDO_EXPECTED[d];
    if (e) out(`  ${d} | ${e.piutangLokal} | ${e.piutangOnline} | ${e.hutangLokal}`);
  }

  // ===== A. MASTER & BALANCE DISCOVERY (cari tm_plg + kolom flag + kolom saldo + view) =====
  out("\n\n##### A. DISCOVERY master AR + kolom saldo/flag #####");
  await step(
    conn,
    "A1 SEMUA tabel/kolom ber-CKDPLG (temukan master AR)",
    "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'CKDPLG' ORDER BY TABLE_NAME",
  );
  await step(
    conn,
    "A2 kolom saldo/piutang/deposit lintas tabel (cari balance terpelihara/view)",
    "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(COLUMN_NAME) LIKE '%saldo%' OR LOWER(COLUMN_NAME) LIKE '%piut%' OR LOWER(COLUMN_NAME) LIKE '%hutang%' ) ORDER BY TABLE_NAME, COLUMN_NAME",
  );
  await step(conn, "A3 DESCRIBE tm_plg", "DESCRIBE tm_plg");
  await step(conn, "A3 sample tm_plg (lihat nilai flag)", "SELECT * FROM tm_plg LIMIT 8");
  await step(
    conn,
    "A4 kandidat kolom flag Lokal/Online di tm_plg (by nama)",
    "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tm_plg' AND ( LOWER(COLUMN_NAME) LIKE '%online%' OR LOWER(COLUMN_NAME) LIKE '%jenis%' OR LOWER(COLUMN_NAME) LIKE '%jns%' OR LOWER(COLUMN_NAME) LIKE '%tipe%' OR LOWER(COLUMN_NAME) LIKE '%type%' OR LOWER(COLUMN_NAME) LIKE '%gol%' OR LOWER(COLUMN_NAME) LIKE '%group%' OR LOWER(COLUMN_NAME) LIKE '%grup%' OR LOWER(COLUMN_NAME) LIKE '%kelompok%' OR LOWER(COLUMN_NAME) LIKE '%kategori%' OR LOWER(COLUMN_NAME) LIKE '%lokal%' ) ORDER BY COLUMN_NAME",
  );

  // ===== B. PIUTANG — interpretasi SJNSBP + model per-pelanggan + flag empiris =====
  out("\n\n##### B. PIUTANG — tr_bppiut model per-pelanggan #####");
  await step(
    conn,
    "B1 arti SJNSBP — sampel baris tiap jenis (VCKET/VCREF/tanda NJUMLAH)",
    "SELECT SJNSBP, VCREF, VCKET, NJUMLAH, DTGL FROM tr_bppiut WHERE COALESCE(SBATAL,0) = 0 AND DTGL BETWEEN '2026-06-17' AND '2026-06-18' ORDER BY SJNSBP, NJUMLAH DESC LIMIT 30",
  );
  out("\n### B2. Saldo per-pelanggan → total (signed/clamp, dua konvensi tanda) vs oracle Lokal+Online");
  for (const date of ["2026-06-18", "2026-06-27"]) {
    await step(
      conn,
      `B2 total saldo as-of ${date} (net1: 1=+,2=−)`,
      "SELECT ROUND(SUM(net),2) AS total_signed, ROUND(SUM(CASE WHEN net > 0 THEN net ELSE 0 END),2) AS total_clamp_pos, ROUND(SUM(CASE WHEN net < 0 THEN net ELSE 0 END),2) AS total_neg, COUNT(*) AS ncust FROM ( SELECT CKDPLG, SUM(CASE SJNSBP WHEN 1 THEN NJUMLAH WHEN 2 THEN -NJUMLAH ELSE 0 END) AS net FROM tr_bppiut WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= ? GROUP BY CKDPLG ) x",
      [date],
    );
    await step(
      conn,
      `B2 total saldo as-of ${date} (net2: 2=+,1=−)`,
      "SELECT ROUND(SUM(net),2) AS total_signed, ROUND(SUM(CASE WHEN net > 0 THEN net ELSE 0 END),2) AS total_clamp_pos, COUNT(*) AS ncust FROM ( SELECT CKDPLG, SUM(CASE SJNSBP WHEN 2 THEN NJUMLAH WHEN 1 THEN -NJUMLAH ELSE 0 END) AS net FROM tr_bppiut WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= ? GROUP BY CKDPLG ) x",
      [date],
    );
  }
  out("\n### B3. Identifikasi ONLINE + flag: dump tm_plg.* per saldo-bucket as-of 18 (kontras kecil≈1,2jt vs besar)");
  await step(
    conn,
    "B3a saldo kecil (1..5jt) + master — kandidat Online",
    "SELECT b.CKDPLG, ROUND(SUM(CASE SJNSBP WHEN 1 THEN NJUMLAH WHEN 2 THEN -NJUMLAH ELSE 0 END),2) AS saldo, m.* FROM tr_bppiut b LEFT JOIN tm_plg m ON m.CKDPLG = b.CKDPLG WHERE COALESCE(b.SBATAL,0) = 0 AND b.DTGL <= '2026-06-18' GROUP BY b.CKDPLG HAVING saldo BETWEEN 1 AND 5000000 ORDER BY saldo LIMIT 40",
  );
  await step(
    conn,
    "B3b saldo besar (>1 miliar) + master — kontras (Lokal)",
    "SELECT b.CKDPLG, ROUND(SUM(CASE SJNSBP WHEN 1 THEN NJUMLAH WHEN 2 THEN -NJUMLAH ELSE 0 END),2) AS saldo, m.* FROM tr_bppiut b LEFT JOIN tm_plg m ON m.CKDPLG = b.CKDPLG WHERE COALESCE(b.SBATAL,0) = 0 AND b.DTGL <= '2026-06-18' GROUP BY b.CKDPLG HAVING saldo > 1000000000 ORDER BY saldo DESC LIMIT 10",
  );

  // ===== C. HUTANG — ledger Σtop-up − Σtarik (cepat; NSALDO dibuang) =====
  out("\n\n##### C. HUTANG — ledger deposit Σtop-up − Σtarik (vs oracle Hutang) #####");
  out("### C1. Total level (semua tanggal): topup(tr_deposit) − tarik(vw_jualplg.CKDDEPO)");
  for (const date of dates) {
    await step(
      conn,
      `C1 topup/tarik/net ≤ ${date}`,
      "SELECT ( SELECT ROUND(SUM(NTOTAL),2) FROM tr_deposit WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= ? ) AS topup, ( SELECT ROUND(SUM(TotalHarga),2) FROM vw_jualplg WHERE COALESCE(SBATAL,0) = 0 AND CKDDEPO IS NOT NULL AND CKDDEPO <> '' AND DTGL <= ? ) AS tarik",
      [date, date],
    );
  }
  out("\n### C2. Per-pelanggan clamp ≥0 (as-of 18 & 27) — bila total level over/under, ini koreksinya");
  for (const date of ["2026-06-18", "2026-06-27"]) {
    await step(
      conn,
      `C2 Σ clamp(topup−tarik) as-of ${date} (grouped-join, cepat)`,
      "SELECT ROUND(SUM(GREATEST(0, COALESCE(t.topup,0) - COALESCE(v.tarik,0))),2) AS hutang_clamp, ROUND(SUM(COALESCE(t.topup,0) - COALESCE(v.tarik,0)),2) AS hutang_signed, COUNT(*) AS ncust FROM ( SELECT CKDPLG, SUM(NTOTAL) AS topup FROM tr_deposit WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= ? GROUP BY CKDPLG ) t LEFT JOIN ( SELECT CKDPLG, SUM(TotalHarga) AS tarik FROM vw_jualplg WHERE COALESCE(SBATAL,0) = 0 AND CKDDEPO IS NOT NULL AND CKDDEPO <> '' AND DTGL <= ? GROUP BY CKDPLG ) v ON v.CKDPLG = t.CKDPLG",
      [date, date],
    );
  }

  out("\n==========================================================");
  out("PROBE RONDE 12 SELESAI — read-only, nol kirim. Tempel output untuk kunci formula.");
  out("==========================================================");
}

/**
 * RONDE 13 (FASE 1 — SALDO, DECISIVE) — temuan ronde 12:
 *   - Flag Lokal/Online = `tm_plg.SJENIS` (int). PIUTANG `tr_bppiut` net OVER ~6,46 M-iliar
 *     (≈ kelas voucher) → butuh SPLIT per-SJENIS utk pisah Lokal/Online & buktikan eksklusi.
 *   - HUTANG kemungkinan dari `tr_bphut` (buku hutang), BUKAN deposit. Plus view rollup
 *     resmi `vw_bukupiuttosend` / `vw_bukuhuttosend` (yang dipakai EasyMax kirim/laporan).
 * Urutan: query MURAH & DECISIVE dulu (split SJENIS + tr_bphut), scan berat vw_jualplg
 * (kandidat hutang-deposit) PALING AKHIR agar tak memotong hasil penting. MySQL 5.0-safe.
 */
export async function runProbe13(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const dates = datesArg.length
    ? datesArg
    : ["2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-21",
       "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-26", "2026-06-27"];
  out("==========================================================");
  out("FASE 1 PROBE RONDE 13 (READ-ONLY, DECISIVE) — SALDO · unit 6478111");
  out("tanggal: " + dates.join(", "));
  out("==========================================================");
  out("\nTarget oracle (Rp): Piutang Lokal | Online | Hutang Lokal");
  for (const d of dates) {
    const e = SALDO_EXPECTED[d];
    if (e) out(`  ${d} | ${e.piutangLokal} | ${e.piutangOnline} | ${e.hutangLokal}`);
  }

  // ===== A. tm_plg.SJENIS distribusi + view/tabel buku resmi =====
  out("\n\n##### A. SJENIS distribusi + buku resmi #####");
  await step(
    conn,
    "A1 distribusi tm_plg.SJENIS (arti kelas)",
    "SELECT SJENIS, COUNT(*) AS n_plg FROM tm_plg GROUP BY SJENIS ORDER BY SJENIS",
  );
  await step(conn, "A2 DESCRIBE tr_bphut", "DESCRIBE tr_bphut");
  await step(conn, "A2 sample tr_bphut", "SELECT * FROM tr_bphut ORDER BY DTGL DESC LIMIT 5");
  await step(conn, "A3 DESCRIBE vw_bukupiuttosend", "DESCRIBE vw_bukupiuttosend");
  await step(conn, "A3 sample vw_bukupiuttosend", "SELECT * FROM vw_bukupiuttosend LIMIT 5");
  await step(conn, "A4 DESCRIBE vw_bukuhuttosend", "DESCRIBE vw_bukuhuttosend");
  await step(conn, "A4 sample vw_bukuhuttosend", "SELECT * FROM vw_bukuhuttosend LIMIT 5");

  // ===== B. PIUTANG split per SJENIS (DECISIVE: pisah Lokal vs Online + eksklusi voucher) =====
  out("\n\n##### B. PIUTANG — net tr_bppiut per SJENIS, as-of per tanggal #####");
  for (const date of dates) {
    await step(
      conn,
      `B per-SJENIS net ≤ ${date}`,
      "SELECT m.SJENIS, ROUND(SUM(CASE b.SJNSBP WHEN 1 THEN b.NJUMLAH WHEN 2 THEN -b.NJUMLAH ELSE 0 END),2) AS saldo, COUNT(DISTINCT b.CKDPLG) AS ncust FROM tr_bppiut b LEFT JOIN tm_plg m ON m.CKDPLG = b.CKDPLG WHERE COALESCE(b.SBATAL,0) = 0 AND b.DTGL <= ? GROUP BY m.SJENIS ORDER BY m.SJENIS",
      [date],
    );
  }

  // ===== C. HUTANG dari tr_bphut (buku hutang) — net per tanggal + per SJENIS =====
  out("\n\n##### C. HUTANG — net tr_bphut per tanggal (vs oracle Hutang Lokal) #####");
  await step(
    conn,
    "C0 domain SJNSBP tr_bphut (tentukan tanda; kumulatif s/d 27)",
    "SELECT SJNSBP, COUNT(*) AS n, ROUND(SUM(NJUMLAH),2) AS total FROM tr_bphut WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= '2026-06-27' GROUP BY SJNSBP ORDER BY SJNSBP",
  );
  for (const date of dates) {
    await step(
      conn,
      `C net tr_bphut ≤ ${date} (dua konvensi)`,
      "SELECT ROUND(SUM(CASE SJNSBP WHEN 1 THEN NJUMLAH WHEN 2 THEN -NJUMLAH ELSE 0 END),2) AS net_1pos, ROUND(SUM(CASE SJNSBP WHEN 2 THEN NJUMLAH WHEN 1 THEN -NJUMLAH ELSE 0 END),2) AS net_2pos, COUNT(*) AS n FROM tr_bphut WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= ?",
      [date],
    );
  }
  out("\n### C-split per SJENIS (as-of 18 & 27) — konfirmasi 'Lokal' & cek apakah ada Online");
  for (const date of ["2026-06-18", "2026-06-27"]) {
    await step(
      conn,
      `C per-SJENIS net tr_bphut ≤ ${date}`,
      "SELECT m.SJENIS, ROUND(SUM(CASE h.SJNSBP WHEN 1 THEN h.NJUMLAH WHEN 2 THEN -h.NJUMLAH ELSE 0 END),2) AS saldo, COUNT(DISTINCT h.CKDPLG) AS ncust FROM tr_bphut h LEFT JOIN tm_plg m ON m.CKDPLG = h.CKDPLG WHERE COALESCE(h.SBATAL,0) = 0 AND h.DTGL <= ? GROUP BY m.SJENIS ORDER BY m.SJENIS",
      [date],
    );
  }

  // ===== D. (cross-check, AKHIR — scan berat) deposit ledger sbg pembanding hutang =====
  out("\n\n##### D. CROSS-CHECK deposit ledger (akhir; bila tr_bphut bukan sumbernya) #####");
  for (const date of ["2026-06-18", "2026-06-27"]) {
    await step(
      conn,
      `D topup−tarik ≤ ${date}`,
      "SELECT ( SELECT ROUND(SUM(NTOTAL),2) FROM tr_deposit WHERE COALESCE(SBATAL,0) = 0 AND DTGL <= ? ) AS topup, ( SELECT ROUND(SUM(TotalHarga),2) FROM vw_jualplg WHERE COALESCE(SBATAL,0) = 0 AND CKDDEPO IS NOT NULL AND CKDDEPO <> '' AND DTGL <= ? ) AS tarik",
      [date, date],
    );
  }

  out("\n==========================================================");
  out("PROBE RONDE 13 SELESAI — read-only, nol kirim. Tempel output untuk kunci formula final.");
  out("==========================================================");
}

/**
 * RONDE 14 (FASE 0.5h) — SUMBER B / "Terra / Nozzle Test" di RINCIAN PENJUALAN.
 *
 * Latar: tabel `tera` (log fisik test-dispense) terbukti SUPERSET dari B. Σ
 * tera.TotalHarga per hari OVERCOUNT di 6/8 hari oracle (15/16/18=0 tapi tera>0;
 * 17/24/26/27 overcount oleh stray-pour). Tak ada kolom TER-SYNC (produk/tangki/
 * nozzle/Jenis/jam/liter) yang memisahkan resmi-vs-stray (17 Jun: nozzle 46 &
 * Jenis 5 yang SAMA terbelah in/out). Tugas: temukan pembeda OTORITATIF.
 *
 * Oracle B (Rp, PDF IB 6478111) — sumber yang BENAR harus reproduksi PERSIS,
 * termasuk NOL di 5/8 hari (penyaring terkuat):
 *   14=0  15=0  16=0  17=1.106.200  18=0  24=350.982  26=349.650  27=445.200
 *
 * Strategi falsifikasi:
 *   T0  Skema PENUH `tera` live (cari kolom TAK-tersync = kandidat flag resmi).
 *   T1  Internal laporan EasyMax (view/procedure di balik Rincian → rumus B).
 *   T2  Semantik `Jenis` + master tera (apakah satu Jenis = "tera resmi"?).
 *   T3  DUMP MENTAH `SELECT *` per hari oracle (DECISIVE): baris in vs out
 *       dibandingkan ke PDF → kolom pembeda tampak. + baseline Σ (rekonfirmasi salah).
 *   T4  Hipotesis jurnal penjualan (tera di-ring di tr_hjualbbm/VCKET?).
 *
 * 🔒 SELECT-only (roQuery → assertSelectOnly). `SHOW CREATE VIEW` DITOLAK guard
 *    (keyword CREATE) → pakai information_schema.VIEWS/ROUTINES.*_DEFINITION.
 *    Catatan: *_DEFINITION bisa NULL bila user readonly_sync tak punya SHOW VIEW/
 *    SHOW ROUTINE — nama objek tetap berguna; laporkan apa adanya.
 */
export async function runProbe14(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const ORACLE_B: Record<string, string> = {
    "2026-06-14": "0",
    "2026-06-15": "0",
    "2026-06-16": "0",
    "2026-06-17": "1.106.200",
    "2026-06-18": "0",
    "2026-06-24": "350.982",
    "2026-06-26": "349.650",
    "2026-06-27": "445.200",
  };
  const dates = datesArg.length ? datesArg : Object.keys(ORACLE_B);
  out("==========================================================");
  out("FASE 0.5h PROBE RONDE 14 (READ-ONLY) — SUMBER B/Terra · unit 6478111");
  out("tanggal: " + dates.join(", "));
  out("==========================================================");
  out("\nOracle B (Rp) — sumber benar HARUS cocok PERSIS, termasuk 0:");
  for (const d of dates) if (ORACLE_B[d]) out(`  ${d} = ${ORACLE_B[d]}`);

  // ===== T0. Skema PENUH tera (kolom tak-tersync = kandidat flag resmi) =====
  out("\n\n##### T0. SKEMA PENUH `tera` (cari kolom di luar 8 yang ter-sync) #####");
  out("  (tersync: TanggalJam,IDPompa,NoNozle,SalTangki,Jenis,Liter,TotalHarga + HargaSatuan tidak)");
  await step(conn, "T0a DESCRIBE tera", "DESCRIBE tera");
  await step(
    conn,
    "T0b kolom tera (tipe/key/null/extra)",
    "SELECT ORDINAL_POSITION AS pos, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE AS nullable, COLUMN_KEY AS kkey, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tera' ORDER BY ORDINAL_POSITION",
  );

  // ===== T1. Internal laporan EasyMax (view/procedure sumber B) =====
  out("\n\n##### T1. INTERNAL LAPORAN (view/procedure → rumus B otoritatif) #####");
  await step(
    conn,
    "T1a procedure/function menyebut tera/nozzle",
    "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ( LOWER(ROUTINE_DEFINITION) LIKE '%tera%' OR LOWER(ROUTINE_DEFINITION) LIKE '%nozle%' OR LOWER(ROUTINE_DEFINITION) LIKE '%nozzle%' OR LOWER(ROUTINE_NAME) LIKE '%tera%' OR LOWER(ROUTINE_NAME) LIKE '%rincian%' ) ORDER BY ROUTINE_NAME",
  );
  await step(
    conn,
    "T1b DEFINISI routine yang menyebut tera (bisa NULL bila tanpa hak)",
    "SELECT ROUTINE_NAME, ROUTINE_TYPE, ROUTINE_DEFINITION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ( LOWER(ROUTINE_DEFINITION) LIKE '%tera%' OR LOWER(ROUTINE_DEFINITION) LIKE '%nozle%' OR LOWER(ROUTINE_DEFINITION) LIKE '%nozzle%' )",
  );
  await step(
    conn,
    "T1c view bernama tera/terra/rincian/rekap/jual/lap",
    "SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(TABLE_NAME) LIKE '%tera%' OR LOWER(TABLE_NAME) LIKE '%terra%' OR LOWER(TABLE_NAME) LIKE '%rincian%' OR LOWER(TABLE_NAME) LIKE '%rekap%' OR LOWER(TABLE_NAME) LIKE '%jual%' OR LOWER(TABLE_NAME) LIKE '%lap%' OR LOWER(TABLE_NAME) LIKE '%report%' ) ORDER BY TABLE_NAME",
  );
  await step(
    conn,
    "T1d view yang DEFINISINYA menyebut tera (+definisi; bisa NULL)",
    "SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(VIEW_DEFINITION) LIKE '%from tera%' OR LOWER(VIEW_DEFINITION) LIKE '%join tera%' OR LOWER(VIEW_DEFINITION) LIKE '%nozle%' OR LOWER(VIEW_DEFINITION) LIKE '%nozzle%' )",
  );
  await step(
    conn,
    "T1e SEMUA objek bernama tera (tabel/view)",
    "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(TABLE_NAME) LIKE '%tera%' OR LOWER(TABLE_NAME) LIKE '%terra%' ) ORDER BY TABLE_NAME",
  );

  // ===== T2. Semantik Jenis + master tera =====
  out("\n\n##### T2. SEMANTIK `Jenis` + master tera #####");
  await step(
    conn,
    "T2a tabel/master bernama jenis/tera",
    "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(TABLE_NAME) LIKE '%jenistera%' OR LOWER(TABLE_NAME) LIKE '%jnstera%' OR LOWER(TABLE_NAME) LIKE '%jenis%' ) ORDER BY TABLE_NAME",
  );
  await step(
    conn,
    "T2b tera per Jenis (overall: apakah satu Jenis = resmi?)",
    "SELECT Jenis, COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM tera WHERE TanggalJam >= '2026-06-01' AND TanggalJam < '2026-07-01' GROUP BY Jenis ORDER BY Jenis",
  );

  // ===== T3. DUMP MENTAH per hari oracle (DECISIVE) =====
  out("\n\n##### T3. DUMP `SELECT *` per hari oracle (kolom pembeda in/out) #####");
  out("  Bandingkan ke PDF: hari B=0 → SEMUA baris 'out'; 17/24/26/27 → sesi ~20L 'in'.");
  for (const date of dates) {
    const next = nextDay(date);
    out(`\n### ${date} (oracle B = ${ORACLE_B[date] ?? "?"})`);
    await step(
      conn,
      `T3 dump tera kalender ${date}`,
      "SELECT * FROM tera WHERE TanggalJam >= ? AND TanggalJam < ? ORDER BY TanggalJam",
      [date + " 00:00:00", next + " 00:00:00"],
    );
    await step(
      conn,
      `T3 baseline Σ tera ${date} (rekonfirmasi salah)`,
      "SELECT COUNT(*) AS n, ROUND(SUM(Liter),2) AS liter, ROUND(SUM(TotalHarga),2) AS total FROM tera WHERE DATE(TanggalJam) = ?",
      [date],
    );
  }

  // ===== T4. Hipotesis jurnal penjualan (tera di-ring sbg sale?) =====
  out("\n\n##### T4. Hipotesis JURNAL PENJUALAN (tera di-ring di tr_hjualbbm?) #####");
  await step(conn, "T4a DESCRIBE tr_hjualbbm", "DESCRIBE tr_hjualbbm");
  await step(conn, "T4b DESCRIBE tr_djualbbm", "DESCRIBE tr_djualbbm");
  for (const date of dates) {
    out(`\n### T4 jurnal ${date} (oracle B = ${ORACLE_B[date] ?? "?"})`);
    await step(
      conn,
      `T4 header VCKET bertanda tera/nozzle ${date}`,
      "SELECT CKDJUALBBM, NSHIFT, DTGLJUAL, VCKET FROM tr_hjualbbm WHERE DTGLJUAL = ? AND ( LOWER(VCKET) LIKE '%tera%' OR LOWER(VCKET) LIKE '%nozle%' OR LOWER(VCKET) LIKE '%nozzle%' OR LOWER(VCKET) LIKE '%kalib%' OR LOWER(VCKET) LIKE '%test%' )",
      [date],
    );
  }

  out("\n==========================================================");
  out("PROBE RONDE 14 SELESAI — read-only, nol kirim. Tempel SELURUH output");
  out("(terutama T0 skema + T1 definisi view + T3 dump per hari) untuk kunci GATE 0.5.");
  out("==========================================================");
}

/**
 * RONDE 15 (FASE 0.5i) — LEDGER TERRA RESMI: tr_hterra/tr_dterra/vw_terra.
 *
 * Terobosan R14: tabel `tera` = log test-pour mentah (SUPERSET, tanpa flag resmi).
 * EasyMax punya LEDGER terra RESMI terpisah → tr_hterra (~418 hdr), tr_dterra
 * (~1.849 dtl), view vw_terra + vw_terratosend (kandidat sumber otoritatif B
 * Rincian + Liter benar utk Laporan Harian + net-sales G/L). Tugas: KUNCI sumber.
 *
 * Oracle B (Rp) + seksi TERRA per-produk (PDF IB 6478111) — sumber benar HARUS
 * reproduksi PERSIS, termasuk 0 di 14/15/16/18:
 *   14=0  15=0  16=0
 *   17=1.106.200  (DEXLITE 21,00/493.500 + PERTALITE 61,27/612.700)
 *   18=0
 *   24=350.982    (PERTAMAX 21,08)
 *   26=349.650    (PERTAMAX 21,00)
 *   27=445.200    (PERTAMAX TURBO 21,00)
 *
 * 🔒 SELECT-only (assertSelectOnly). `SHOW CREATE VIEW` DITOLAK guard (keyword
 *    CREATE) → definisi via information_schema.VIEWS.VIEW_DEFINITION (bisa kosong
 *    bila user readonly_sync tanpa SHOW VIEW — base table tetap otoritatif).
 *    Query rekon pakai TEBAKAN kolom (konvensi EasyMax: hdr DTGL/CKDTERRA/SBATAL,
 *    dtl CKDBBM + Liter/TotalHarga ATAU NVOLUME/NSUBTOTAL); yang salah → ERROR
 *    tercetak (tak fatal), DESCRIBE + dump mentah jadi sumber kebenaran.
 */
export async function runProbe15(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const ORACLE_B: Record<string, string> = {
    "2026-06-14": "0",
    "2026-06-15": "0",
    "2026-06-16": "0",
    "2026-06-17": "1.106.200  (DEXLITE 21,00/493.500 + PERTALITE 61,27/612.700)",
    "2026-06-18": "0",
    "2026-06-24": "350.982  (PERTAMAX 21,08)",
    "2026-06-26": "349.650  (PERTAMAX 21,00)",
    "2026-06-27": "445.200  (PERTAMAX TURBO 21,00)",
  };
  const dates = datesArg.length ? datesArg : Object.keys(ORACLE_B);
  const HOT = ["2026-06-17", "2026-06-24", "2026-06-26", "2026-06-27"]; // B>0 (rekon ketat)
  const TERRA_OBJ = ["tr_hterra", "tr_dterra", "vw_terra", "vw_terratosend"];
  out("==========================================================");
  out("FASE 0.5i PROBE RONDE 15 (READ-ONLY) — LEDGER TERRA RESMI · unit 6478111");
  out("tanggal: " + dates.join(", "));
  out("==========================================================");
  out("\nOracle B (Rp) + seksi TERRA per-produk — sumber benar HARUS cocok PERSIS:");
  for (const d of dates) if (ORACLE_B[d]) out(`  ${d} = ${ORACLE_B[d]}`);

  // ===== A. DEFINISI view + SKEMA penuh 4 objek =====
  out("\n\n##### A. DEFINISI vw_terra/vw_terratosend + SKEMA 4 objek #####");
  await step(
    conn,
    "A1 VIEW_DEFINITION (SHOW CREATE diblok guard → information_schema)",
    "SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('vw_terra','vw_terratosend')",
  );
  await step(
    conn,
    "A2 SEMUA kolom 4 objek (pos/tipe/key)",
    "SELECT TABLE_NAME, ORDINAL_POSITION AS pos, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE AS nullable, COLUMN_KEY AS kkey FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tr_hterra','tr_dterra','vw_terra','vw_terratosend') ORDER BY TABLE_NAME, ORDINAL_POSITION",
  );
  for (const t of TERRA_OBJ) {
    await step(conn, `A3 DESCRIBE ${t}`, `DESCRIBE ${t}`);
    await step(conn, `A3 sample ${t}`, `SELECT * FROM ${t} LIMIT 8`);
  }
  await step(
    conn,
    "A4 jumlah baris 4 objek",
    "SELECT (SELECT COUNT(*) FROM tr_hterra) AS hdr, (SELECT COUNT(*) FROM tr_dterra) AS dtl, (SELECT COUNT(*) FROM vw_terra) AS v_terra, (SELECT COUNT(*) FROM vw_terratosend) AS v_tosend",
  );

  // ===== B. DUMP MENTAH Juni (gabung hdr⋈dtl; tebakan DTGL + CKDTERRA) =====
  out("\n\n##### B. DUMP MENTAH ledger Juni 14–27 (tebakan kolom; bila ERROR → pakai A) #####");
  await step(
    conn,
    "B1 tr_hterra⋈tr_dterra Juni (DTGL+CKDTERRA)",
    "SELECT h.CKDTERRA, h.DTGL, h.NSHIFT, h.SBATAL, d.* FROM tr_hterra h JOIN tr_dterra d ON d.CKDTERRA = h.CKDTERRA WHERE h.DTGL >= ? AND h.DTGL <= ? ORDER BY h.DTGL, h.CKDTERRA",
    ["2026-06-14", "2026-06-27"],
  );
  await step(
    conn,
    "B2 tr_hterra Juni (header saja; kalau B1 ERROR di join)",
    "SELECT * FROM tr_hterra WHERE DTGL >= ? AND DTGL <= ? ORDER BY DTGL",
    ["2026-06-14", "2026-06-27"],
  );
  await step(
    conn,
    "B3 vw_terra Juni (tebakan kolom tanggal DTGL)",
    "SELECT * FROM vw_terra WHERE DTGL >= ? AND DTGL <= ? ORDER BY DTGL LIMIT 200",
    ["2026-06-14", "2026-06-27"],
  );
  await step(
    conn,
    "B4 vw_terratosend Juni (tebakan kolom tanggal DTGL)",
    "SELECT * FROM vw_terratosend WHERE DTGL >= ? AND DTGL <= ? ORDER BY DTGL LIMIT 200",
    ["2026-06-14", "2026-06-27"],
  );

  // ===== C. REKON per hari oracle (B per-hari + per-produk; tebakan kolom) =====
  out("\n\n##### C. REKON per hari (Σ Rp == oracle B; per-produk by tm_bbm.VCNMBBM) #####");
  for (const date of dates) {
    out(`\n### ${date} (oracle B = ${ORACLE_B[date] ?? "?"})`);
    await step(
      conn,
      `C1 Σ per-hari ${date} (Liter/TotalHarga)`,
      "SELECT ROUND(SUM(d.TotalHarga),2) AS rp_total, ROUND(SUM(d.Liter),2) AS liter_total, COUNT(*) AS n FROM tr_hterra h JOIN tr_dterra d ON d.CKDTERRA = h.CKDTERRA WHERE h.DTGL = ? AND COALESCE(h.SBATAL,0) = 0",
      [date],
    );
    if (HOT.includes(date)) {
      await step(
        conn,
        `C2 per-produk ${date} (resolve nama by VCNMBBM)`,
        "SELECT bb.VCNMBBM AS produk, ROUND(SUM(d.Liter),2) AS liter, ROUND(SUM(d.TotalHarga),2) AS rp, COUNT(*) AS n FROM tr_hterra h JOIN tr_dterra d ON d.CKDTERRA = h.CKDTERRA LEFT JOIN tm_bbm bb ON TRIM(bb.CKDBBM) = TRIM(d.CKDBBM) WHERE h.DTGL = ? AND COALESCE(h.SBATAL,0) = 0 GROUP BY bb.VCNMBBM ORDER BY rp DESC",
        [date],
      );
      await step(
        conn,
        `C3 Σ per-hari ${date} FALLBACK (NVOLUME/NSUBTOTAL)`,
        "SELECT ROUND(SUM(d.NSUBTOTAL),2) AS rp_total, ROUND(SUM(d.NVOLUME),2) AS liter_total, COUNT(*) AS n FROM tr_hterra h JOIN tr_dterra d ON d.CKDTERRA = h.CKDTERRA WHERE h.DTGL = ? AND COALESCE(h.SBATAL,0) = 0",
        [date],
      );
    }
  }

  // ===== D. GROUPING — kalender DTGL vs shift-3 (spillover) =====
  out("\n\n##### D. GROUPING: header per DTGL + cek field waktu (shift-3 spillover) #####");
  for (const date of HOT) {
    await step(
      conn,
      `D header ${date} (DTGL + NSHIFT + semua kolom hdr utk lihat field waktu)`,
      "SELECT * FROM tr_hterra WHERE DTGL = ? ORDER BY 1",
      [date],
    );
  }

  // ===== E. DELTA vs `tera` mentah (bug Laporan Harian — khusus Pertalite) =====
  out("\n\n##### E. DELTA Liter: ledger RESMI vs `tera` mentah, per-produk/hari #####");
  for (const date of dates) {
    await step(
      conn,
      `E tera MENTAH per-produk ${date} (SalTangki→tm_tangki→tm_bbm)`,
      "SELECT bb.VCNMBBM AS produk, ROUND(SUM(t.Liter),2) AS liter_mentah, ROUND(SUM(t.TotalHarga),2) AS rp_mentah, COUNT(*) AS n FROM tera t LEFT JOIN tm_tangki tg ON CAST(tg.CKDTANGKI2 AS UNSIGNED) = t.SalTangki LEFT JOIN tm_bbm bb ON TRIM(bb.CKDBBM) = TRIM(tg.CKDBBM) WHERE DATE(t.TanggalJam) = ? GROUP BY bb.VCNMBBM ORDER BY produk",
      [date],
    );
  }

  // ===== F. RESUME OPERASIONAL — sumber terra-nya (harus SAMA dgn Rincian) =====
  out("\n\n##### F. RESUME/Laporan — view/routine yang menyentuh terra #####");
  await step(
    conn,
    "F1 view bernama resume/operasional/arus/bbm/lap",
    "SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(TABLE_NAME) LIKE '%resume%' OR LOWER(TABLE_NAME) LIKE '%operasional%' OR LOWER(TABLE_NAME) LIKE '%arus%' OR LOWER(TABLE_NAME) LIKE '%bbm%' OR LOWER(TABLE_NAME) LIKE '%lap%' ) ORDER BY TABLE_NAME",
  );
  await step(
    conn,
    "F2 view yang DEFINISINYA menyentuh terra/tera",
    "SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND ( LOWER(VIEW_DEFINITION) LIKE '%tr_dterra%' OR LOWER(VIEW_DEFINITION) LIKE '%tr_hterra%' OR LOWER(VIEW_DEFINITION) LIKE '%from tera%' OR LOWER(VIEW_DEFINITION) LIKE '%join tera%' )",
  );
  await step(
    conn,
    "F3 routine yang menyentuh terra/tera (definisi)",
    "SELECT ROUTINE_NAME, ROUTINE_TYPE, ROUTINE_DEFINITION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ( LOWER(ROUTINE_DEFINITION) LIKE '%tr_dterra%' OR LOWER(ROUTINE_DEFINITION) LIKE '%terra%' OR LOWER(ROUTINE_DEFINITION) LIKE '% tera %' )",
  );

  // ===== G. PK / natural key / watermark (utk desain UPSERT nanti) =====
  out("\n\n##### G. PK / index / watermark ledger (fakta utk sync, JANGAN implement) #####");
  await step(
    conn,
    "G1 kolom ber-key (PRI/UNI/MUL) hdr+dtl",
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_KEY, ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tr_hterra','tr_dterra') AND COLUMN_KEY <> '' ORDER BY TABLE_NAME, ORDINAL_POSITION",
  );
  await step(
    conn,
    "G2 index lengkap hdr+dtl",
    "SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX AS seq, COLUMN_NAME, NON_UNIQUE AS nonuniq FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tr_hterra','tr_dterra') ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
  );
  await step(
    conn,
    "G3 rentang DTGL header (watermark? tebakan DTGL)",
    "SELECT MIN(DTGL) AS mn, MAX(DTGL) AS mx, COUNT(*) AS n FROM tr_hterra",
  );

  out("\n==========================================================");
  out("PROBE RONDE 15 SELESAI — read-only, nol kirim. Tempel SELURUH output");
  out("(A definisi/skema + B dump Juni + C rekon + F sumber RESUME) untuk GATE 0.5 final.");
  out("Tip encoding: arahkan ke UTF-8 (Out-File -Encoding utf8) agar tak ter-garble.");
  out("==========================================================");
}

/**
 * RONDE 16 (FASE 0.5j) — REKON ledger terra resmi dgn KOLOM BENAR (R15 discovery).
 *
 * R15 mengunci skema (recon R15 gagal krn tebak kolom):
 *   tr_hterra : CKDTERRA(PK) · DTGLTERRA(date, BIZ-DATE) · NSHIFT · CKDJUALBBM(FK→sales) ·
 *               VCKET · SBATAL · VCALASAN · SEDIT
 *   tr_dterra : CKDTERRA(FK) · CKDNOZZLE · NVOLUME(L) · NHARGA · NTOTAL(Rp) · CHASIL ·
 *               VCULANG · SEDIT · DTGLJAM(datetime) · CKDTANGKI · CKDBBM
 *   vw_terra  : per-pour + nama resolve (VCNMBBM/VCNMTANGKI…) + DTGLTERRA/NSHIFT/SBATAL
 *
 * Tujuan: rekon Σ NTOTAL per DTGLTERRA == oracle B (8 hari, termasuk 0); per-produk
 * 17/24/26/27; grouping DTGLTERRA vs DATE(DTGLJAM) (shift-3); watermark; link sales.
 * 🔒 SELECT-only (assertSelectOnly).
 */
export async function runProbe16(
  conn: EasyMaxConnection,
  datesArg: string[] = [],
): Promise<void> {
  const ORACLE_B: Record<string, string> = {
    "2026-06-14": "0",
    "2026-06-15": "0",
    "2026-06-16": "0",
    "2026-06-17": "1.106.200  (DEXLITE 21,00/493.500 + PERTALITE 61,27/612.700)",
    "2026-06-18": "0",
    "2026-06-24": "350.982  (PERTAMAX 21,08)",
    "2026-06-26": "349.650  (PERTAMAX 21,00)",
    "2026-06-27": "445.200  (PERTAMAX TURBO 21,00)",
  };
  const dates = datesArg.length ? datesArg : Object.keys(ORACLE_B);
  const HOT = ["2026-06-17", "2026-06-24", "2026-06-26", "2026-06-27"];
  out("==========================================================");
  out("FASE 0.5j PROBE RONDE 16 (READ-ONLY) — REKON ledger terra (kolom benar)");
  out("tanggal: " + dates.join(", "));
  out("==========================================================");
  out("\nOracle B (Rp) — Σ NTOTAL per DTGLTERRA HARUS cocok PERSIS, termasuk 0:");
  for (const d of dates) if (ORACLE_B[d]) out(`  ${d} = ${ORACLE_B[d]}`);

  // ===== R. REKON per hari (Σ NTOTAL per DTGLTERRA) =====
  out("\n\n##### R. REKON Σ per hari (DTGLTERRA, SBATAL=0) vs oracle B #####");
  for (const date of dates) {
    out(`\n### ${date} (oracle B = ${ORACLE_B[date] ?? "?"})`);
    await step(
      conn,
      `R1 Σ ledger ${date}`,
      "SELECT ROUND(SUM(d.NTOTAL),2) AS rp_total, ROUND(SUM(d.NVOLUME),2) AS liter_total, COUNT(*) AS n FROM tr_hterra h JOIN tr_dterra d ON d.CKDTERRA = h.CKDTERRA WHERE h.DTGLTERRA = ? AND COALESCE(h.SBATAL,0) = 0",
      [date],
    );
    if (HOT.includes(date)) {
      await step(
        conn,
        `R2 per-produk ${date} (vw_terra.VCNMBBM)`,
        "SELECT VCNMBBM AS produk, ROUND(SUM(NVOLUME),2) AS liter, ROUND(SUM(NTOTAL),2) AS rp, COUNT(*) AS n FROM vw_terra WHERE DTGLTERRA = ? AND COALESCE(SBATAL,0) = 0 GROUP BY VCNMBBM ORDER BY rp DESC",
        [date],
      );
    }
  }

  // ===== S. DUMP MENTAH Juni (hdr⋈dtl) — verifikasi baris + SBATAL =====
  out("\n\n##### S. DUMP ledger Juni 14–27 (hdr⋈dtl, semua SBATAL) #####");
  await step(
    conn,
    "S1 tr_hterra⋈tr_dterra Juni",
    "SELECT h.CKDTERRA, h.DTGLTERRA, h.NSHIFT, h.SBATAL, h.CKDJUALBBM, d.DTGLJAM, d.CKDNOZZLE, d.CKDTANGKI, d.CKDBBM, d.NVOLUME, d.NTOTAL FROM tr_hterra h JOIN tr_dterra d ON d.CKDTERRA = h.CKDTERRA WHERE h.DTGLTERRA >= ? AND h.DTGLTERRA <= ? ORDER BY h.DTGLTERRA, d.DTGLJAM",
    ["2026-06-14", "2026-06-27"],
  );
  await step(
    conn,
    "S2 header Juni SBATAL<>0 (tera dibatalkan?)",
    "SELECT CKDTERRA, DTGLTERRA, NSHIFT, SBATAL, VCKET, VCALASAN FROM tr_hterra WHERE DTGLTERRA >= ? AND DTGLTERRA <= ? AND COALESCE(SBATAL,0) <> 0",
    ["2026-06-14", "2026-06-27"],
  );

  // ===== T. GROUPING: DTGLTERRA vs DATE(DTGLJAM) (shift-3 spillover) =====
  out("\n\n##### T. GROUPING — biz-date DTGLTERRA vs wall-clock DATE(DTGLJAM) #####");
  await step(
    conn,
    "T1 DTGLTERRA × pour-date Juni (lihat shift-3 lintas tengah malam)",
    "SELECT h.DTGLTERRA, h.NSHIFT, DATE(d.DTGLJAM) AS pour_date, COUNT(*) AS n, ROUND(SUM(d.NTOTAL),2) AS rp FROM tr_hterra h JOIN tr_dterra d ON d.CKDTERRA = h.CKDTERRA WHERE h.DTGLTERRA >= ? AND h.DTGLTERRA <= ? GROUP BY h.DTGLTERRA, h.NSHIFT, DATE(d.DTGLJAM) ORDER BY h.DTGLTERRA, pour_date",
    ["2026-06-14", "2026-06-27"],
  );

  // ===== U. WATERMARK / rentang (utk desain sync incremental) =====
  out("\n\n##### U. WATERMARK & rentang (fakta sync; JANGAN implement) #####");
  await step(
    conn,
    "U1 rentang DTGLTERRA header",
    "SELECT MIN(DTGLTERRA) AS mn, MAX(DTGLTERRA) AS mx, COUNT(*) AS n FROM tr_hterra",
  );
  await step(
    conn,
    "U2 rentang DTGLJAM detail (cek tanggal sampah <2020 / >2030)",
    "SELECT MIN(DTGLJAM) AS mn, MAX(DTGLJAM) AS mx, COUNT(*) AS n, SUM(CASE WHEN DTGLJAM < '2020-01-01' THEN 1 ELSE 0 END) AS pre2020 FROM tr_dterra",
  );

  // ===== V. LINK ke jurnal penjualan (CKDJUALBBM) — biz-date konsisten? =====
  out("\n\n##### V. LINK terra→sales (CKDJUALBBM): DTGLTERRA == DTGLJUAL? #####");
  await step(
    conn,
    "V1 hdr terra ⋈ tr_hjualbbm Juni",
    "SELECT h.CKDTERRA, h.DTGLTERRA, h.NSHIFT AS terra_shift, h.CKDJUALBBM, j.DTGLJUAL, j.NSHIFT AS jual_shift FROM tr_hterra h LEFT JOIN tr_hjualbbm j ON j.CKDJUALBBM = h.CKDJUALBBM WHERE h.DTGLTERRA >= ? AND h.DTGLTERRA <= ? ORDER BY h.DTGLTERRA",
    ["2026-06-14", "2026-06-27"],
  );

  out("\n==========================================================");
  out("PROBE RONDE 16 SELESAI — read-only, nol kirim. Tempel SELURUH output");
  out("(R rekon 8-hari + R2 per-produk + S dump + T grouping) untuk GATE 0.5 FINAL.");
  out("Encoding: Out-File -Encoding utf8 (hindari garble).");
  out("==========================================================");
}
