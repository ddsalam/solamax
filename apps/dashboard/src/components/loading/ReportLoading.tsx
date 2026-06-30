"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Spinner } from "./Spinner";

/**
 * Pesan reasuransi BERTINGKAT untuk beban laporan berat (G/L sebulan di /board &
 * /laporan; ~70–83 dtk di f1-micro). Skeleton tetap statis; baris ini (aria-live
 * polite) menaik seiring waktu. "Batal" muncul di tier ~4 dtk → router.back():
 * JUJUR sebagai "berhenti menunggu / kembali", BUKAN membunuh query (query server
 * tetap jalan s/d statement_timeout 120 dtk — lihat db.ts).
 */
const TIERS: { at: number; msg: string }[] = [
  { at: 0, msg: "Menyiapkan laporan…" },
  { at: 4_000, msg: "Masih memproses — laporan bulanan ini memang berat." },
  { at: 12_000, msg: "Server database kecil; agregasi sebulan butuh waktu. Mohon tunggu…" },
  {
    at: 30_000,
    msg: "Hampir selesai — terima kasih atas kesabaran Anda. Bisa memakan waktu hingga ~2 menit.",
  },
];

const SHOW_CANCEL_AT = 4_000;

export function ReportLoading() {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const id = setInterval(() => setElapsed(performance.now() - start), 1_000);
    return () => clearInterval(id);
  }, []);

  const tier = TIERS.reduce((acc, t) => (elapsed >= t.at ? t : acc), TIERS[0]!);
  const showCancel = elapsed >= SHOW_CANCEL_AT;

  return (
    <div className="report-load">
      <span className="report-load-msg" role="status" aria-live="polite">
        <Spinner size="sm" inline label={tier.msg} />
        {tier.msg}
      </span>
      {showCancel && (
        <button type="button" className="btn-outline" onClick={() => router.back()}>
          ← Batal — berhenti menunggu, kembali
        </button>
      )}
    </div>
  );
}
