"use client";

/**
 * Dudukan klien untuk "Cetak PDF" (Layar 2).
 *
 * Ketiga panel diserahkan APA ADANYA dari server — objek `PanelLaporan` yang
 * sama yang dirender `PanelLaporanKeuangan`. PDF tidak pernah memanggil
 * `panelCashFlow`/`panelIncome`/`panelBalance` sendiri: satu pembuat vonis,
 * dua penyaji.
 */
import { useCallback } from "react";
import type { PanelBalance, PanelLaporan } from "@/lib/keuangan-laporan-model";
import { buildLaporanKeuanganDoc } from "@/lib/export/keuangan-harian-doc";
import type { KopKeuangan } from "@/lib/export/keuangan-kop";
import { KeuanganExport } from "./KeuanganExport";

export function LaporanKeuanganExportMount({
  kop,
  filename,
  cashFlow,
  income,
  balance,
  incomplete,
  catatanNilaiDo,
}: {
  kop: KopKeuangan;
  filename: string;
  cashFlow: PanelLaporan;
  income: PanelLaporan;
  balance: PanelBalance;
  incomplete: readonly string[];
  catatanNilaiDo: string;
}) {
  const buildDoc = useCallback(
    () => buildLaporanKeuanganDoc({ kop, cashFlow, income, balance, incomplete, catatanNilaiDo }),
    [kop, cashFlow, income, balance, incomplete, catatanNilaiDo],
  );
  return <KeuanganExport judul="Cetak laporan keuangan harian" filename={filename} buildDoc={buildDoc} />;
}
