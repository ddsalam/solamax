import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Config-driven (CLAUDE.md): host, port, user, interval, API key, base URL.
 * Sumber: file JSON (default `config.local.json`, DI-GITIGNORE) + override env
 * untuk secret (SOLAMAX_MYSQL_PASSWORD, SOLAMAX_API_KEY). Tak ada kredensial di git.
 */
const ConfigSchema = z.object({
  unitCode: z.string().min(1), // mis. "6478111"
  timezone: z.string().default("Asia/Pontianak"), // WIB/UTC+7

  mysql: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().default(3306),
    user: z.string().min(1), // user SELECT-only, mis. "readonly_sync"
    password: z.string().default(""),
    database: z.string().default("easymax"),
    connectTimeoutMs: z.number().int().default(10_000),
    /**
     * Driver: "mysql2" (default) atau "mysql" (classic, fallback untuk server
     * 5.0 dengan old_passwords/handshake lawas — lihat RUNBOOK-SPBU.md).
     */
    driver: z.enum(["mysql2", "mysql"]).default("mysql2"),
    /** Charset handshake. Server 5.0 tak kenal utf8mb4; fallback: LATIN1_SWEDISH_CI. */
    charset: z.string().default("UTF8_GENERAL_CI"),
  }),

  backend: z.object({
    baseUrl: z.string().url(), // mis. https://ingest-xxxx.run.app
    apiKey: z.string().min(1),
    requestTimeoutMs: z.number().int().default(20_000),
  }),

  sync: z.object({
    pollIntervalMs: z.number().int().default(120_000), // 2 menit
    masterIntervalMs: z.number().int().default(3_600_000), // 1 jam (master jarang berubah)
    // Pelanggan = domain BERAT (union view ~12 dtk). Poll jarang (15 mnt) agar
    // ringan ke DB POS; laporan harian tak butuh real-time per-menit.
    pelangganIntervalMs: z.number().int().default(900_000), // 15 menit
    safetyWindowMin: z.number().int().default(60), // re-scan trailing (temuan Q-SALES-3)
    cashRescanDays: z.number().int().default(7),
    // Window rescan TEBUS (penebusan DO, DTGLTBS date). DO header final per hari;
    // koreksi/pembatalan jarang → 7 hari cukup. UPSERT by PK CKDTBS (idempoten).
    tebusRescanDays: z.number().int().default(7),
    // Rescan SALES per business-date (DTGLJUAL) — menyembuhkan baris shift-3
    // ber-DTGLJAM NULL & koreksi back-dated yang lolos sync incremental
    // (DTGLJAM>watermark). 7 hari menutup pengisian susulan H+beberapa hari.
    salesRescanDays: z.number().int().default(7),
    // Interval rescan SALES (BUKAN tiap poll): baris late shift-3/edit datang dalam
    // hitungan jam, bukan menit → 30 mnt cukup, hindari re-UPSERT ~1k baris/poll ke
    // Cloud SQL (write-load/biaya). Set 0 → tiap siklus.
    salesRescanIntervalMs: z.number().int().default(1_800_000), // 30 menit
    // Lebar window query rescan/re-sync SALES (anti-stall; base-table InnoDB).
    salesResyncChunkDays: z.number().int().default(3),
    // Window rescan EDC (business-date ctgl). EDC final per hari, koreksi jarang
    // → 5 hari cukup; backend REPLACE per business_date (jangan re-delete 266k/cycle).
    edcRescanDays: z.number().int().default(5),
    // Window rescan pelanggan (DTGL header). SEMPIT (3 hari) karena query union
    // view berat di MySQL 5.0 (~4 dtk/hari); 3 hari menutup shift-3 lewat-malam +
    // margin (≈12 dtk). Koreksi >3 hari lampau = limitasi pilot (lihat FASE1-PLAN).
    pelangganRescanDays: z.number().int().default(3),
    // Lebar window backfill pelanggan (sekali, produksi). Jalan-mundur per window
    // agar tiap query vw_jualplg ter-bound (DTGL pushdown) — hindari materialisasi
    // 288k sekaligus yang STALL di mesin SPBU (21 Jun). 7 hari ≈ ringan & deterministik.
    pelangganChunkDays: z.number().int().default(7),
    batchSize: z.number().int().default(1000),

    // --- Track 2 (2026-07-02): sapuan lebar generik, menutup akar Transaksi
    // Pelanggan (koreksi EasyMax > window rescan hot-path tak ter-recapture)
    // untuk SEMUA domain berjendela — bukan cuma pelanggan. Dua tier: (1)
    // sapuan jendela-terkini per siklus (nightly/weekly, generalisasi
    // syncSalesRescan), (2) sapuan full-history off-peak jarang sebagai
    // BACKSTOP (jaring terakhir — tak bergantung intervensi manual).
    // Off-peak WIB [start,end) — jam sepi pompa; gerbang utk KEDUA tier.
    offPeakStartHourWib: z.number().int().default(2),
    offPeakEndHourWib: z.number().int().default(5),
    // Lebar chunk query per window sapuan (anti-stall 288k 21 Jun) — sama
    // utk tier-1 & tier-2, semua domain.
    deepSweepChunkDays: z.number().int().default(7),

    // Tier 1 — sapuan jendela-terkini, per domain (lebar + interval sendiri).
    pelangganDeepRescanDays: z.number().int().default(30),
    pelangganDeepRescanIntervalMs: z.number().int().default(86_400_000), // nightly
    edcDeepRescanDays: z.number().int().default(30),
    edcDeepRescanIntervalMs: z.number().int().default(86_400_000),
    opnameDeepRescanDays: z.number().int().default(14),
    opnameDeepRescanIntervalMs: z.number().int().default(86_400_000),
    deliveryDeepRescanDays: z.number().int().default(14),
    deliveryDeepRescanIntervalMs: z.number().int().default(86_400_000),
    teraDeepRescanDays: z.number().int().default(14),
    teraDeepRescanIntervalMs: z.number().int().default(86_400_000),
    cashDeepRescanDays: z.number().int().default(30),
    cashDeepRescanIntervalMs: z.number().int().default(604_800_000), // weekly
    tebusDeepRescanDays: z.number().int().default(30),
    tebusDeepRescanIntervalMs: z.number().int().default(604_800_000),

    // Tier 2 — backstop full-history, jarang + off-peak. Domain berat
    // (pelanggan/edc, union-view/join mahal di MySQL 5.0) dapat sapuan
    // MENENGAH mingguan (wideSweepDays) + full-history tetap bulanan; domain
    // ringan (opname/delivery/tera/cash/tebus) langsung full-history bulanan.
    //
    // ⚠️ BATAS TERSADAR (keputusan owner, 2026-07-02, GATE 6): floor ini
    // ROLLING (hari-ini − N), BUKAN "sejak data mulai". Seiring waktu, jendela
    // ini bergeser maju — apa pun sebelum floor TAK PERNAH disapu otomatis oleh
    // tier mana pun (tier1/tier2-wide/tier2-full), selamanya, di bawah
    // konfigurasi ini. Diverifikasi nyata: backfill awal pelanggan (2026-06-21,
    // sebelum Track 1/2) meninggalkan 2023-03-15 senilai −71,9% vs EasyMax-now,
    // tak pernah ter-recapture sampai sapuan manual satu-kali (`--deep-sweep
    // <domain> ~1460`, floor ke ~2022-07, GATE 6/7) menutupnya.
    // Keputusan: TIDAK melebarkan floor 1095-hari ini secara permanen & TIDAK
    // menambah tier baru — risiko residual (koreksi EasyMax pada data >3 tahun
    // tak ter-tangkap otomatis) diterima sebagai dapat diabaikan utk data BBM
    // SPBU. Bila prioritas berubah, opsi: lebarkan `fullSweepFloorDays` (biaya:
    // durasi bulanan lebih panjang — pelanggan @1095h sudah ~85 mnt) atau
    // jadwalkan sapuan manual "sejak-inception" berkala di luar cadence ini.
    fullSweepFloorDays: z.number().int().default(1095), // ~3 tahun (BUKAN sejak inception — lihat catatan di atas)
    fullSweepIntervalMs: z.number().int().default(2_592_000_000), // ~30 hari
    wideSweepDays: z.number().int().default(90),
    wideSweepIntervalMs: z.number().int().default(604_800_000), // weekly
  }),

  // Direktori state lokal (watermark + buffer offline). DI-GITIGNORE.
  dataDir: z.string().default("./data"),
});

export type AgentConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(opts?: { configPath?: string }): AgentConfig {
  const path = resolve(
    opts?.configPath ??
      process.env.SOLAMAX_AGENT_CONFIG ??
      "config.local.json",
  );

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Gagal baca config '${path}'. Salin config.example.json → config.local.json lalu isi. (${String(err)})`,
    );
  }

  const parsed = ConfigSchema.parse(raw);

  // Override secret dari env (didahulukan agar tak menaruh secret di file).
  const pwd = process.env.SOLAMAX_MYSQL_PASSWORD;
  if (pwd !== undefined) parsed.mysql.password = pwd;
  const apiKey = process.env.SOLAMAX_API_KEY;
  if (apiKey !== undefined) parsed.backend.apiKey = apiKey;

  return parsed;
}
