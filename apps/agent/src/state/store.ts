import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Domain } from "@solamax/shared";
import type { IngestPayload } from "@solamax/shared";
import { log } from "../logger.js";

/**
 * State lokal agent (DI-GITIGNORE via dataDir):
 *  - watermark.json — last_watermark per domain (persisten antar-run).
 *  - buffer/*.json  — payload yang gagal terkirim saat backend offline; di-flush
 *                     urut (FIFO) di siklus berikutnya. Idempoten di backend → aman.
 *
 * Sengaja pakai file biasa (bukan SQLite) agar tanpa native build — penting di
 * mesin server SPBU lawas (era MySQL 5.0/Windows tua).
 */
export class StateStore {
  private readonly wmPath: string;
  private readonly bufferDir: string;
  private watermarks: Record<string, string | null>;
  private seq = 0;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.bufferDir = join(dataDir, "buffer");
    mkdirSync(this.bufferDir, { recursive: true });
    this.wmPath = join(dataDir, "watermark.json");
    this.watermarks = this.loadWatermarks();
  }

  private loadWatermarks(): Record<string, string | null> {
    if (!existsSync(this.wmPath)) return {};
    try {
      return JSON.parse(readFileSync(this.wmPath, "utf8"));
    } catch (err) {
      log.warn("watermark.json korup — mulai dari kosong", { err: String(err) });
      return {};
    }
  }

  getWatermark(domain: Domain): string | null {
    return this.watermarks[domain] ?? null;
  }

  /** Tulis watermark secara atomik (tulis temp lalu rename). */
  setWatermark(domain: Domain, value: string): void {
    this.watermarks[domain] = value;
    const tmp = this.wmPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.watermarks, null, 2));
    renameSync(tmp, this.wmPath);
  }

  /** Simpan payload ke buffer offline (FIFO via nama file terurut). */
  enqueue(payload: IngestPayload): void {
    const name = `${Date.now().toString().padStart(15, "0")}-${(this.seq++)
      .toString()
      .padStart(4, "0")}.json`;
    writeFileSync(join(this.bufferDir, name), JSON.stringify(payload));
  }

  bufferedFiles(): string[] {
    return readdirSync(this.bufferDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  }

  bufferCount(): number {
    return this.bufferedFiles().length;
  }

  /**
   * Flush buffer FIFO. `send` melempar bila gagal → berhenti (sisa tetap di
   * buffer untuk percobaan berikutnya). Mengembalikan jumlah yang terkirim.
   */
  async drainBuffer(
    send: (payload: IngestPayload) => Promise<void>,
  ): Promise<number> {
    let sent = 0;
    for (const file of this.bufferedFiles()) {
      const full = join(this.bufferDir, file);
      const payload = JSON.parse(readFileSync(full, "utf8")) as IngestPayload;
      await send(payload); // melempar → hentikan drain
      rmSync(full);
      sent++;
    }
    return sent;
  }
}
