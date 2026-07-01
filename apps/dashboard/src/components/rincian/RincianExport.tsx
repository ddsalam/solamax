"use client";

/**
 * Toolbar + workflow ekspor Rincian (menggantikan RincianToolbar lama; jalur
 * ekspor tunggal via pdfmake). Mempertahankan toggle layar "sembunyikan section
 * kosong" (URL param) agar tampilan layar tidak berubah. PDF dibangun dari model
 * yang SAMA dengan layar (angka identik) + data ber-scope (tak ada fetch baru).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ExportButton } from "@/components/export/ExportButton";
import { ExportDialog } from "@/components/export/ExportDialog";
import { usePdfExport } from "@/components/export/usePdfExport";
import { DEFAULT_EXPORT_CONFIG, sectionEnabled, type ExportConfig } from "@/lib/export/config";
import { buildReportFilename } from "@/lib/export/filename";
import { buildRincianDocDefinition, type RincianDocMeta } from "@/lib/export/rincian-doc";
import type { RincianModel } from "@/lib/rincian-model";

export function RincianExport({
  code,
  businessDate,
  generatedDate,
  model,
  meta,
}: {
  code: string;
  /** Tanggal bisnis ISO (periode laporan). */
  businessDate: string;
  /** Tanggal dibuat (WIB) ISO untuk nama file. */
  generatedDate: string;
  model: RincianModel;
  meta: RincianDocMeta;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const hideEmptyScreen = params.get("kosong") !== "tampil";
  const toggleScreen = (hide: boolean) =>
    router.push(`/unit/${code}/rincian/${businessDate}${hide ? "" : "?kosong=tampil"}`);

  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_EXPORT_CONFIG);
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const { status, previewUrl, error, lastFilename, preview, download } = usePdfExport();

  const filename = useMemo(
    () =>
      buildReportFilename({
        reportName: "Rincian-Penjualan",
        unitCode: code,
        period: businessDate,
        generated: generatedDate,
      }),
    [code, businessDate, generatedDate],
  );

  // Ambil logo (PNG dari /public) sekali → data URL untuk disematkan ke PDF.
  useEffect(() => {
    let alive = true;
    fetch("/brand/solamax-horizontal.png")
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("logo"))))
      .then(
        (blob) =>
          new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result as string);
            fr.onerror = () => rej(fr.error);
            fr.readAsDataURL(blob);
          }),
      )
      .then((url) => {
        if (alive) setLogo(url);
      })
      .catch(() => {
        /* fallback wordmark teks di PDF */
      });
    return () => {
      alive = false;
    };
  }, []);

  const buildDoc = useCallback(
    (cfg: ExportConfig) =>
      buildRincianDocDefinition({ model, meta, config: cfg, logoDataUrl: logo }),
    [model, meta, logo],
  );

  // Regenerasi preview saat panel terbuka / config / logo berubah (preview == output).
  useEffect(() => {
    if (!open) return;
    void preview(buildDoc(config));
  }, [open, config, buildDoc, preview]);

  const onQuickDownload = () => void download(buildDoc(config), filename);
  const onDialogDownload = () => void download(buildDoc(config), filename);

  const setSection = (num: string, on: boolean) =>
    setConfig((c) => ({ ...c, sections: { ...c.sections, [num]: on } }));

  return (
    <div className="no-print card card-pad rincian-toolbar">
      <label className="rincian-check">
        <input
          type="checkbox"
          checked={hideEmptyScreen}
          onChange={(e) => toggleScreen(e.target.checked)}
        />
        <span className="fs16 t-secondary">Sembunyikan section kosong</span>
      </label>

      <ExportButton
        onDownload={onQuickDownload}
        onOptions={() => setOpen(true)}
        pending={!open && status === "working"}
      />

      <ExportDialog
        open={open}
        title="Ekspor PDF — Rincian Penjualan"
        onClose={() => setOpen(false)}
        status={status}
        error={error}
        previewUrl={previewUrl}
        filename={filename}
        lastFilename={lastFilename}
        onDownload={onDialogDownload}
      >
        <div className="export-group">
          <div className="fs15 w700 t-tertiary">Isi</div>
          <label className="export-check">
            <input
              type="checkbox"
              checked={config.hideEmpty}
              onChange={(e) => setConfig((c) => ({ ...c, hideEmpty: e.target.checked }))}
            />
            <span className="fs15 t-secondary">Sembunyikan section tanpa transaksi</span>
          </label>
          <label className="export-check">
            <input
              type="checkbox"
              checked={config.includeSignature}
              onChange={(e) => setConfig((c) => ({ ...c, includeSignature: e.target.checked }))}
            />
            <span className="fs15 t-secondary">Sertakan blok tanda tangan</span>
          </label>
        </div>

        <div className="export-group">
          <div className="fs15 w700 t-tertiary">Section</div>
          {model.sections.map((s) => (
            <label key={s.num} className="export-check">
              <input
                type="checkbox"
                checked={sectionEnabled(config, s.num)}
                onChange={(e) => setSection(s.num, e.target.checked)}
              />
              <span className="fs15 t-secondary">
                {s.num}. {s.title}
                {s.rows.length === 0 && <span className="t-tertiary"> · kosong</span>}
              </span>
            </label>
          ))}
        </div>
      </ExportDialog>
    </div>
  );
}
