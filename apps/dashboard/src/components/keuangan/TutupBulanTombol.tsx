"use client";

import { useState, useTransition } from "react";
import { tutupBulan } from "@/lib/tutup-bulan-actions";

/**
 * Tombol TUTUP BULAN (U12). Dirender HANYA bagi HoF / super admin (`canTutupBulan`
 * dihitung di server — halaman yang memutuskan apakah komponen ini tampil), dan
 * aktif HANYA bila vonis server lolos. Aksi membaca ulang semua syarat di bawah
 * kuncinya sendiri: tombol yang aktif bukan izin, hanya ajakan.
 */
export function TutupBulanTombol({ code, bulan, siap }: { code: string; bulan: string; siap: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const tutup = (): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await tutupBulan({ code, bulan });
      if (!r.ok) setErr(r.error);
      else setMsg(r.pesan);
    });
  };

  return (
    <div className="card card-pad-lg keu-form mt6">
      <h3 className="text-h3">Tutup bulan {bulan}</h3>
      <p className="fs16 t-secondary mt2">
        Bulan yang ditutup tidak bisa dibuka ulang. Koreksi sesudahnya dibukukan maju ke bulan terbuka berikutnya,
        dan rekening koran bulan ini tidak lagi bisa ditarik atau dibatalkan pencocokannya.
      </p>
      {msg !== null && (
        <div className="banner info keu-banner" role="status">
          {msg}
        </div>
      )}
      {err !== null && (
        <div className="banner danger keu-banner" role="alert">
          {err}
        </div>
      )}
      <div className="manual-form-actions">
        <button type="button" className="btn-navy" onClick={tutup} disabled={pending || !siap}>
          {pending ? "Menutup…" : "Tutup bulan"}
        </button>
      </div>
      {!siap && <p className="fs16 t-tertiary mt2">Tombol aktif setelah keempat syarat di atas OK.</p>}
    </div>
  );
}
