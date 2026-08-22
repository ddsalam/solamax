"use client";

/**
 * Dudukan klien untuk "Cetak ringkasan" (Layar 1).
 *
 * Server tak bisa menyerahkan closure ke klien, jadi yang menyeberang adalah
 * DATA yang sudah jadi — `BarisUnit[]` yang SAMA dengan yang dirender tabelnya.
 * Dokumennya dibangun di sini dari data itu, tanpa satu pun query baru dan tanpa
 * satu pun hitungan yang tak dilakukan layarnya.
 */
import { useCallback } from "react";
import type { BarisUnit } from "@/lib/keuangan-papan-model";
import { buildPapanKeuanganDoc } from "@/lib/export/keuangan-papan-doc";
import type { KopKeuangan } from "@/lib/export/keuangan-kop";
import { KeuanganExport } from "./KeuanganExport";

export function PapanExportMount({
  baris,
  kop,
  filename,
}: {
  baris: BarisUnit[];
  kop: KopKeuangan;
  filename: string;
}) {
  const buildDoc = useCallback(() => buildPapanKeuanganDoc({ kop, baris }), [kop, baris]);
  return (
    <KeuanganExport
      judul="Cetak ringkasan keuangan grup"
      filename={filename}
      orientation="landscape"
      buildDoc={buildDoc}
    />
  );
}
