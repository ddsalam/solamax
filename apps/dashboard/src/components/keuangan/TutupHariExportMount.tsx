"use client";

/** Dudukan klien cetakan Layar 4 (§10.20). Data diserahkan apa adanya. */
import { useCallback } from "react";
import type { DayCloseRow, OverrideRow } from "@/lib/keuangan-input-queries";
import type { Tier } from "@/lib/keuangan-tutup-hari";
import { buildTutupHariDoc } from "@/lib/export/tutup-hari-doc";
import type { KopKeuangan } from "@/lib/export/keuangan-kop";
import { KeuanganExport } from "./KeuanganExport";

export function TutupHariExportMount({
  kop,
  filename,
  dayClose,
  langkahHarian,
  tier,
  overrides,
  labelReason,
}: {
  kop: KopKeuangan;
  filename: string;
  dayClose: DayCloseRow | null;
  langkahHarian: number | null;
  tier: Tier | null;
  overrides: readonly OverrideRow[];
  labelReason: Record<string, string>;
}) {
  const buildDoc = useCallback(
    () => buildTutupHariDoc({ kop, dayClose, langkahHarian, tier, overrides, labelReason }),
    [kop, dayClose, langkahHarian, tier, overrides, labelReason],
  );
  return <KeuanganExport judul="Cetak lembar penutupan hari" filename={filename} buildDoc={buildDoc} />;
}
