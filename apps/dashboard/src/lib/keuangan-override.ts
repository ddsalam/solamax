/**
 * Jalur tembus BACKDATE — aturan MURNI (tanpa I/O).
 *
 * Keputusan owner 13 Agustus 2026 (KEUANGAN-HARIAN.md §2.2): INSERT ke hari yang
 * sudah ditutup **ditahan secara default**, dengan jalur tembus bagi Finance
 * yang memakai reason code + approver.
 *
 * ⛔ Pembagian lapis — jangan dikaburkan:
 *
 * | dijaga DB (migrasi 0027) | dijaga modul ini |
 * |---|---|
 * | ada override, DISETUJUI, BELUM terpakai | approver memenuhi `canCloseException` |
 * | `requested_by <> approved_by` | pengaju/approver bukan orang yang sama *sebelum* menulis |
 * | reason code ber-`applies_to='adjustment'` | reason code dipilih dari daftar `adjustment` |
 * | konsumsi tercatat & tertaut ke entri | — |
 *
 * DB **tidak bisa** menegakkan `canCloseException`: keanggotaan Head of Finance
 * hidup di ENV (`HEAD_OF_FINANCE_EMAILS`, §10.4), di luar jangkauan Postgres.
 * Menegakkan bagian rolenya saja di DB akan **salah menolak** HoF, yang perannya
 * `admin_perusahaan`. Jadi lapis ini bukan pelengkap — ia satu-satunya tempat
 * kapabilitas itu diperiksa.
 *
 * Kenapa sesensitif menutup hari di luar toleransi: mem-backdate ke hari
 * tertutup **membuka kembali** hari yang sudah disahkan. Wewenangnya karena itu
 * disamakan dengan `canCloseException` (tingkat kedua §3.2), bukan diturunkan.
 */
import { canCloseException, type WewenangCtx } from "./keuangan-wewenang";

export interface PermintaanOverride {
  requestedByUserId: number;
  approvedByUserId: number | null;
  /** Kode dari master `reason_code`. */
  reasonCode: string | null;
  /** `reason_code.applies_to` untuk kode itu; `null` bila kode null. */
  reasonAppliesTo: string | null;
  /** Alasan tertulis. Spasi saja dihitung kosong. */
  alasan: string | null;
}

export type KekuranganOverride =
  | "reason_code"
  | "reason_bukan_adjustment"
  | "alasan"
  | "approver"
  | "approver_sama_dengan_pengaju"
  | "wewenang_approver";

export type HasilOverride =
  | { boleh: true }
  | { boleh: false; kurang: ReadonlyArray<KekuranganOverride> };

/**
 * Boleh menerbitkan override backdate?
 *
 * `ctxApprover` adalah konteks orang yang **menyetujui**, bukan yang mengajukan.
 * Melaporkan SEMUA kekurangan sekaligus — supaya pengguna tidak diperbaiki
 * satu-satu oleh gerbang yang menahan satu syarat per kali.
 */
export function bolehMenerbitkanOverride(
  p: PermintaanOverride,
  ctxApprover: WewenangCtx,
  daftarHof?: readonly string[],
): HasilOverride {
  const kurang: KekuranganOverride[] = [];

  if (!p.reasonCode) kurang.push("reason_code");
  else if (p.reasonAppliesTo !== "adjustment") kurang.push("reason_bukan_adjustment");

  if ((p.alasan ?? "").trim() === "") kurang.push("alasan");

  if (p.approvedByUserId === null) {
    kurang.push("approver");
  } else {
    if (p.approvedByUserId === p.requestedByUserId) kurang.push("approver_sama_dengan_pengaju");
    if (!canCloseException(ctxApprover, daftarHof)) kurang.push("wewenang_approver");
  }

  return kurang.length === 0 ? { boleh: true } : { boleh: false, kurang };
}

/**
 * Apakah override ini masih bisa dipakai?
 *
 * **SEKALI PAKAI** (keputusan owner: pilih salah satu dari sekali-pakai /
 * berbatas-waktu). Begitu `consumedAt` terisi, ia habis — selamanya.
 *
 * 🔴 Inilah syarat terpenting jalur tembus ini: override yang MENETAP membuka
 * hari itu selamanya dan tak seorang pun akan menyadarinya.
 */
export function overrideMasihBerlaku(o: {
  approvedAt: string | null;
  consumedAt: string | null;
  void: boolean;
}): boolean {
  return !o.void && o.approvedAt !== null && o.consumedAt === null;
}
