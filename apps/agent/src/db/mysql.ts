import mysql2 from "mysql2/promise";
import classicMysql from "mysql";
import type { AgentConfig } from "../config.js";
import { log } from "../logger.js";
import { assertSelectOnly } from "./readonly-guard.js";

/**
 * Koneksi read-only ke MySQL `easymax`. SATU-SATUNYA pintu ke driver MySQL.
 * Semua query lewat `roQuery()` yang menegakkan assertSelectOnly() (lihat
 * readonly-guard.ts).
 *
 * Dua driver (temuan #3: server MySQL 5.0.67, handshake/auth lawas):
 *  - "mysql2" (default) — modern; auth mysql_native_password (hash 4.1, 41-char).
 *  - "mysql"  (classic) — fallback bila server memakai old_passwords / meminta
 *    protokol auth pra-4.1; `insecureAuth: true` mengizinkannya.
 * Keduanya: `dateStrings` (datetime dikembalikan string mentah — agent yang
 * konversi WIB→UTC, lihat transform.ts), `multipleStatements: false`, dan
 * text protocol (placeholder di-escape client-side — aman untuk 5.0).
 */

interface RawConn {
  query(sql: string, params: ReadonlyArray<unknown>): Promise<unknown[]>;
  end(): Promise<void>;
}

async function openMysql2(m: AgentConfig["mysql"]): Promise<RawConn> {
  const conn = await mysql2.createConnection({
    host: m.host,
    port: m.port,
    user: m.user,
    password: m.password,
    database: m.database,
    dateStrings: true,
    multipleStatements: false,
    insecureAuth: true,
    connectTimeout: m.connectTimeoutMs,
    charset: m.charset,
  });
  return {
    async query(sql, params) {
      const [rows] = await conn.query(sql, params as unknown[]);
      return rows as unknown[];
    },
    end: () => conn.end(),
  };
}

function openClassic(m: AgentConfig["mysql"]): Promise<RawConn> {
  const conn = classicMysql.createConnection({
    host: m.host,
    port: m.port,
    user: m.user,
    password: m.password,
    database: m.database,
    dateStrings: true,
    multipleStatements: false,
    insecureAuth: true, // izinkan auth pra-4.1 (old_passwords) milik 5.0
    connectTimeout: m.connectTimeoutMs,
    charset: m.charset,
  });
  return new Promise((resolve, reject) => {
    conn.connect((err) => {
      if (err) return reject(err);
      resolve({
        query: (sql, params) =>
          new Promise((res, rej) =>
            conn.query(sql, params as unknown[], (e, rows) =>
              e ? rej(e) : res(rows as unknown[]),
            ),
          ),
        end: () => new Promise<void>((res) => conn.end(() => res())),
      });
    });
  });
}

export class EasyMaxConnection {
  private constructor(private readonly conn: RawConn) {}

  static async open(cfg: AgentConfig): Promise<EasyMaxConnection> {
    log.info("membuka koneksi MySQL", {
      driver: cfg.mysql.driver,
      host: cfg.mysql.host,
      port: cfg.mysql.port,
      user: cfg.mysql.user,
    });
    const raw =
      cfg.mysql.driver === "mysql"
        ? await openClassic(cfg.mysql)
        : await openMysql2(cfg.mysql);
    return new EasyMaxConnection(raw);
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
    const rows = await this.conn.query(sql, params);
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
    return { version: r.version, timeZone: r.tz, now: String(r.now) };
  }

  async close(): Promise<void> {
    try {
      await this.conn.end();
    } catch (err) {
      log.warn("gagal menutup koneksi MySQL", { err: String(err) });
    }
  }
}
