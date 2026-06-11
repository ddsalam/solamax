import mysql from "mysql2/promise";
import type { AgentConfig } from "../config.js";
import { log } from "../logger.js";
import { assertSelectOnly } from "./readonly-guard.js";

/**
 * Koneksi read-only ke MySQL `easymax`. SATU-SATUNYA pintu ke driver MySQL.
 * Semua query lewat `roQuery()` yang menegakkan assertSelectOnly() (lihat
 * readonly-guard.ts). Catatan MySQL 5.0.67: butuh `dateStrings` agar datetime
 * dikembalikan apa adanya (string), bukan di-parse oleh driver dengan asumsi
 * timezone — agent yang mengonversi WIB→UTC secara eksplisit (lihat transform.ts).
 */
export class EasyMaxConnection {
  private constructor(private readonly conn: mysql.Connection) {}

  static async open(cfg: AgentConfig): Promise<EasyMaxConnection> {
    const conn = await mysql.createConnection({
      host: cfg.mysql.host,
      port: cfg.mysql.port,
      user: cfg.mysql.user,
      password: cfg.mysql.password,
      database: cfg.mysql.database,
      // MySQL 5.0.67: kembalikan DATE/DATETIME sebagai string mentah.
      dateStrings: true,
      // Cegah multi-statement di level driver (pertahanan ekstra).
      multipleStatements: false,
      // Auth lawas pra-4.1 bila server pakai old_passwords.
      insecureAuth: true,
      connectTimeout: cfg.mysql.connectTimeoutMs,
    });
    return new EasyMaxConnection(conn);
  }

  /**
   * Jalankan SELECT read-only dengan parameter. Melempar bila query bukan
   * SELECT murni — pertahanan berlapis agar tak pernah menulis ke easymax.
   */
  async roQuery<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<T[]> {
    assertSelectOnly(sql);
    const [rows] = await this.conn.query(sql, params as unknown[]);
    return rows as T[];
  }

  /** Tes konektivitas + versi server (untuk smoke test MySQL 5.0). */
  async ping(): Promise<{ version: string; timeZone: string; now: string }> {
    const rows = await this.roQuery<{
      version: string;
      tz: string;
      now: string;
    }>(
      "SELECT VERSION() AS version, @@session.time_zone AS tz, NOW() AS now",
    );
    const r = rows[0];
    if (!r) throw new Error("ping gagal: tak ada baris");
    return { version: r.version, timeZone: r.tz, now: r.now };
  }

  async close(): Promise<void> {
    try {
      await this.conn.end();
    } catch (err) {
      log.warn("gagal menutup koneksi MySQL", { err: String(err) });
    }
  }
}
