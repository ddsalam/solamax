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
    // Rescan SALES per business-date (DTGLJUAL) tiap siklus — menyembuhkan baris
    // shift-3 ber-DTGLJAM NULL & koreksi back-dated yang lolos sync incremental
    // (DTGLJAM>watermark). 7 hari menutup pengisian susulan H+beberapa hari.
    salesRescanDays: z.number().int().default(7),
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
