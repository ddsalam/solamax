/**
 * PDF ⇒ teks tata-letak lewat `pdftotext -layout` (poppler-utils, dipasang di
 * tahap runtime `apps/dashboard/Dockerfile`) — masukan `impor-bank-parser.ts`.
 *
 * Dikeraskan untuk berkas UNGGAHAN (Implementation Constraints):
 *   · kepala bukan `%PDF` ditolak sebelum apa pun dijalankan;
 *   · `execFile` dengan argv — TANPA shell, nama berkas tak pernah ditafsirkan;
 *   · batas waktu tetap & batas halaman (`-l`); keluaran dibatasi `maxBuffer`;
 *   · berkas sementara di direktori sendiri di bawah `os.tmpdir()`, dihapus di
 *     `finally` apa pun hasilnya.
 *
 * Pemanggil memeriksa wewenang SEBELUM membaca berkas (bukan tugas modul ini).
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BATAS_WAKTU_MS = 10_000;
/** E-statement nyata 1 bulan ±10–21 halaman; kelebihannya terpotong ⇒ kaki hilang ⇒ parser menolak. */
export const MAKS_HALAMAN_BAWAAN = 60;
const MAKS_KELUARAN = 8 * 1024 * 1024;

export class GalatPdfTeks extends Error {
  constructor(
    readonly kode: "bukan-pdf" | "pdftotext-tidak-ada" | "waktu-habis" | "gagal",
    message: string,
  ) {
    super(message);
    this.name = "GalatPdfTeks";
  }
}

export async function teksDariPdf(isi: Buffer, opsi: { maksHalaman?: number } = {}): Promise<string> {
  if (isi.length < 4 || isi.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new GalatPdfTeks("bukan-pdf", "Berkas bukan PDF — unggah e-statement PDF dari BCA.");
  }
  const maksHalaman = opsi.maksHalaman ?? MAKS_HALAMAN_BAWAAN;
  if (!Number.isInteger(maksHalaman) || maksHalaman < 1) throw new RangeError("maksHalaman harus bilangan bulat ≥ 1");

  const dir = await mkdtemp(join(tmpdir(), "solamax-pdf-"));
  try {
    const berkas = join(dir, "masukan.pdf");
    await writeFile(berkas, isi, { mode: 0o600 });
    return await new Promise<string>((selesai, gagal) => {
      execFile(
        "pdftotext",
        ["-layout", "-enc", "UTF-8", "-l", String(maksHalaman), berkas, "-"],
        { timeout: BATAS_WAKTU_MS, killSignal: "SIGKILL", maxBuffer: MAKS_KELUARAN, encoding: "utf8" },
        (err, stdout, stderr) => {
          if (!err) return selesai(stdout);
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          if (e.code === "ENOENT") {
            return gagal(new GalatPdfTeks("pdftotext-tidak-ada", "pdftotext tidak terpasang di server (poppler-utils)."));
          }
          if (e.killed || e.signal === "SIGKILL") {
            return gagal(new GalatPdfTeks("waktu-habis", `Membaca PDF melebihi ${BATAS_WAKTU_MS / 1000} detik — berkas ditolak.`));
          }
          const pesan = String(stderr || e.message).trim().split("\n")[0];
          return gagal(new GalatPdfTeks("gagal", `PDF tidak dapat dibaca: ${pesan}`));
        },
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
