import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
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
  private readonly corruptDir: string;
  private watermarks: Record<string, string | null>;
  private seq = 0;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.bufferDir = join(dataDir, "buffer");
    mkdirSync(this.bufferDir, { recursive: true });
    // Dibuat saat dibutuhkan saja (lihat quarantine) agar tujuh mesin SPBU tak
    // dipenuhi folder kosong yang mengesankan ada masalah.
    this.corruptDir = join(dataDir, "buffer-rusak");
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

  /**
   * Simpan payload ke buffer offline (FIFO via nama file terurut).
   *
   * Ditulis ATOMIK (temp lalu rename), sama seperti `setWatermark`. Buffer ini
   * ada justru untuk bertahan dari kegagalan, jadi ia harus tahan terhadap
   * kegagalan **saat sedang menulis dirinya sendiri**: `writeFileSync` biasa
   * yang terpotong mati listrik meninggalkan berkas ter-alokasi berisi NUL di
   * NTFS, dan berkas itu memutus unitnya (insiden Imam Bonjol 16–17 Sep 2026).
   * `bufferedFiles()` menyaring `.json` sehingga sisa `.tmp` tak pernah ikut
   * terbaca bila rename-nya sendiri yang gagal.
   */
  enqueue(payload: IngestPayload): void {
    const name = `${Date.now().toString().padStart(15, "0")}-${(this.seq++)
      .toString()
      .padStart(4, "0")}.json`;
    const full = join(this.bufferDir, name);
    const tmp = `${full}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, full);
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
      let payload: IngestPayload;
      try {
        payload = JSON.parse(readFileSync(full, "utf8")) as IngestPayload;
      } catch (err) {
        // Entri yang TAK TERBACA tak boleh menghentikan antrean. Ia takkan
        // pernah bisa dikirim, sedangkan penghapusannya digerbangi kirim-sukses
        // di bawah — membiarkannya di tempat berarti antrean ini tak pernah maju
        // satu langkah pun dan unitnya berhenti SELAMANYA. Karantina lalu lanjut.
        this.quarantine(full, err);
        continue;
      }
      await send(payload); // melempar → hentikan drain
      rmSync(full);
      sent++;
    }
    return sent;
  }

  /**
   * Pindahkan entri tak terbaca keluar dari jalur, simpan untuk forensik.
   *
   * Membuangnya tidak menghilangkan data: watermark hanya maju setelah batch
   * sukses di-ingest backend (lihat `syncDatetimeDomain`), sehingga payload yang
   * sempat ter-buffer meninggalkan watermark di tempat dan siklus berikutnya
   * membacanya ulang dari MySQL — UPSERT-nya idempoten.
   */
  private quarantine(full: string, err: unknown): void {
    const file = basename(full);
    try {
      mkdirSync(this.corruptDir, { recursive: true });
      const dest = join(this.corruptDir, file);
      renameSync(full, dest);
      log.error("entri buffer tak terbaca — dikarantina", {
        file,
        dest,
        err: String(err),
      });
    } catch (mvErr) {
      // Karantina gagal (izin/disk penuh). Hapus sebagai upaya terakhir:
      // membiarkannya berarti unit ini berhenti tanpa batas waktu, dan datanya
      // tetap bisa dibaca ulang dari MySQL.
      rmSync(full, { force: true });
      log.error("entri buffer tak terbaca — karantina GAGAL, entri dihapus", {
        file,
        err: String(err),
        quarantineErr: String(mvErr),
      });
    }
  }
}
