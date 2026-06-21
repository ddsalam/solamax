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
