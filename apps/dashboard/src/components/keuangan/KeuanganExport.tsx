"use client";

/**
 * Tombol ekspor PDF modul keuangan — SATU komponen untuk kedua layar.
 *
 * ⛔ Ia **tidak** membangun dokumennya sendiri: pemanggil menyerahkan
 * `buildDoc` yang sudah terikat pada model yang SAMA dengan yang dirender
 * halaman. Dengan begitu tak ada jalan bagi PDF menghitung ulang dan berbeda
 * dari layarnya tanpa ada yang tahu.
 *
 * ⛔ **Bukan rute baru.** Ekspor terjadi di peramban, pada halaman yang sudah
 * lolos gerbang bacanya (`canViewLaporanKeuangan` → `notFound()`). Tak ada
 * `page.tsx` baru, tak ada handler server — jadi tak ada permukaan ketujuh yang
 * bisa lolos karena bentuknya beda. Dijaga `gerbang-rute-keuangan.guard.test.ts`
 * yang menemukan rutenya sendiri dari berkas.
 */
import { useCallback, useState } from "react";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { ExportButton } from "@/components/export/ExportButton";
import { ExportDialog } from "@/components/export/ExportDialog";
import { usePdfExport } from "@/components/export/usePdfExport";

export function KeuanganExport({
  judul,
  filename,
  orientation = "portrait",
  buildDoc,
}: {
  judul: string;
  filename: string;
  orientation?: "portrait" | "landscape";
  buildDoc: () => TDocumentDefinitions;
}) {
  const [open, setOpen] = useState(false);
  const { status, previewUrl, error, lastFilename, preview, download, reset } = usePdfExport();

  const unduh = useCallback(async () => {
    await download(buildDoc(), filename);
  }, [download, buildDoc, filename]);

  const bukaOpsi = useCallback(async () => {
    setOpen(true);
    await preview(buildDoc());
  }, [preview, buildDoc]);

  return (
    <>
      <ExportButton onDownload={unduh} onOptions={bukaOpsi} pending={status === "working"} />
      {open && (
        <ExportDialog
          open={open}
          title={judul}
          onClose={() => {
            setOpen(false);
            reset();
          }}
          status={status}
          previewUrl={previewUrl}
          error={error}
          filename={filename}
          lastFilename={lastFilename}
          orientation={orientation}
          onDownload={unduh}
        >
          {/* Tak ada opsi yang mengubah ISI: apa yang diekspor adalah apa yang
              terlihat. Panel ini hanya pratinjau — supaya pratinjau == keluaran. */}
          <p className="fs16 t-tertiary">
            Isi PDF mengikuti layar apa adanya, termasuk keadaan kosongnya. Tak ada
            pilihan yang bisa menyembunyikan baris.
          </p>
        </ExportDialog>
      )}
    </>
  );
}
