/**
 * Satu baris JSON per peristiwa, ber-kunci `severity`.
 *
 * ⚠️ KENAPA INI ADA. Alarm SolaMax dibawa oleh SEVERITY LOG, bukan status HTTP
 * (lihat doktrin di `sync-health.controller.ts`). Tetapi `Logger` bawaan Nest
 * mencetak teks berformat, sehingga Cloud Logging tak punya kunci `severity`
 * untuk dibaca dan harus menebaknya dari stream. Menebak dari stream berarti
 * SELURUH stderr menjadi ERROR — termasuk baris peringatan yang bukan insiden —
 * sehingga alert policy tidak bisa dipersempit tanpa kehilangan daya beda.
 *
 * Bentuk JSON satu baris membuat `severity` menjadi FAKTA yang dikirim aplikasi,
 * bukan tebakan infrastruktur.
 *
 * 🛑 KONTRAK DENGAN METRIK — JANGAN DIUBAH TANPA MENGUBAH FILTERNYA LEBIH DULU.
 * Penanda teks hidup di kunci `msg`, dan log-based metric mencocokinya. Selama
 * masa transisi, filter metrik HARUS menerima kedua bentuk:
 *
 *   (textPayload:"frozen_shift_incident" OR jsonPayload.msg="frozen_shift_incident")
 *   AND severity>=ERROR
 *
 * Filter dua-bentuk itu benar SEBELUM maupun SESUDAH revisi ini hidup, jadi
 * urutan pemasangannya tidak bisa salah. Filter yang hanya menyebut
 * `textPayload:` akan BERHENTI COCOK begitu revisi ini hidup — alarmnya padam
 * tanpa satu pun galat.
 *
 * `message` ikut diisi supaya baris ini terbaca di Logs Explorer tanpa membuka
 * jsonPayload; `msg` yang dipakai filter.
 */
export type LogSeverity = "INFO" | "WARNING" | "ERROR";

export type StructuredPayload = Record<string, unknown> & { msg: string };

type Writer = (line: string) => void;

const toStdout: Writer = (line) => { process.stdout.write(line); };
const toStderr: Writer = (line) => { process.stderr.write(line); };

export function formatStructuredLine(
  severity: LogSeverity,
  context: string,
  payload: StructuredPayload,
): string {
  let body: string;
  try {
    body = JSON.stringify({ severity, context, message: payload.msg, ...payload });
  } catch {
    // Payload yang tak bisa diserialisasi TIDAK BOLEH membungkam alarmnya.
    // Penandanya tetap terbit; rinciannya yang hilang, dan hilangnya disebut.
    body = JSON.stringify({
      severity, context, message: payload.msg, msg: payload.msg,
      detail_unserializable: true,
    });
  }
  return `${body}\n`;
}

export class StructuredLogger {
  constructor(
    private readonly context: string,
    private readonly writeInfo: Writer = toStdout,
    private readonly writeError: Writer = toStderr,
  ) {}

  /** Senyap secara default: INFO tidak dikonsumsi alert policy mana pun. */
  log(payload: StructuredPayload): void {
    this.writeInfo(formatStructuredLine("INFO", this.context, payload));
  }

  error(payload: StructuredPayload): void {
    this.writeError(formatStructuredLine("ERROR", this.context, payload));
  }
}
