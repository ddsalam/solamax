"use client";

/**
 * "Ekspor CSV" — Layar 1 (§10.19).
 *
 * ⚠️ Mockup menulis **"Ekspor XLSX"**. Labelnya sengaja berbeda: yang dihasilkan
 * adalah CSV, dan **tombol harus menyebut isinya dengan benar**. Tombol yang
 * berbohong tentang isinya lebih buruk daripada tombol yang belum ada.
 * Penyimpangan tercatat di `design/keuangan-modul/README.md`.
 */
import { useCallback, useState } from "react";
import { LoadingButton } from "@/components/loading/LoadingButton";
import { papanCsv } from "@/lib/export/csv";
import type { BarisUnit } from "@/lib/keuangan-papan-model";

export function PapanCsvButton({
  baris,
  tanggal,
  filename,
}: {
  baris: BarisUnit[];
  tanggal: string;
  filename: string;
}) {
  const [pending, setPending] = useState(false);

  const unduh = useCallback(() => {
    setPending(true);
    try {
      const blob = new Blob([papanCsv(baris, tanggal)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setPending(false);
    }
  }, [baris, tanggal, filename]);

  return (
    <LoadingButton pending={pending} pendingLabel="Menyiapkan…" className="btn-tint" onClick={unduh}>
      Ekspor CSV
    </LoadingButton>
  );
}
