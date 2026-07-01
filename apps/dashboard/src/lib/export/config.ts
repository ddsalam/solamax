/**
 * Konfigurasi ekspor Rincian. Kertas dikunci A4 (realita bisnis Indonesia) —
 * tidak ada opsi ukuran. Default dipilih agar "Unduh PDF" langsung menghasilkan
 * dokumen yang benar tanpa perlu mengubah apa pun (Prinsip 2).
 */
export interface ExportConfig {
  /** Sembunyikan section tanpa transaksi (default true). */
  hideEmpty: boolean;
  /** Sertakan section per-nomor ("1".."7"). Tak tercantum = disertakan. */
  sections: Record<string, boolean>;
  /** Sertakan blok tanda tangan (default true). */
  includeSignature: boolean;
}

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  hideEmpty: true,
  sections: {},
  includeSignature: true,
};

/** True bila section num aktif menurut config (default: aktif). */
export function sectionEnabled(config: ExportConfig, num: string): boolean {
  return config.sections[num] !== false;
}
