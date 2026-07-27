"use client";

import { useEffect, useState } from "react";

/**
 * Banner hasil aksi admin — MELAYANG di puncak viewport.
 *
 * Kenapa `position: fixed` dan bukan di aliran halaman: versi pertama merender
 * banner di puncak DOKUMEN, sementara form "Beri akses" ada di y≈4859 pada halaman
 * produksi setinggi ~6640 px. Jaraknya ~4.550 px ≈ 3,5 layar — banner-nya benar dan
 * terender, tapi tak pernah masuk viewport orang yang baru saja menekan "Simpan
 * akses". Untuk sepuluh operasi berurutan, umpan balik yang harus dicari dengan
 * menggulir sama saja dengan tidak ada.
 *
 * Kenapa cacat ini lolos verifikasi sebelumnya: ia diperagakan dari sesi
 * `admin_perusahaan`, yang menurut desain TIDAK BOLEH memanggil `grantAccess`.
 * Jalur sukses yang teruji adalah `updateScope`, yang kontrolnya ada di dalam blok
 * orang — dekat puncak halaman. Peran yang dipakai menguji secara struktural tak
 * bisa menempuh jalur yang gagal.
 *
 * ⚠️ Komponen ini MURNI presentasi. Teks dan netralitasnya ditentukan server
 * (`PESAN_HASIL` di admin-rules.ts): satu teks untuk SEMUA penolakan wewenang, apa
 * pun sebabnya. Jangan menurunkan teks dari sebab di sini — itu akan mengembalikan
 * kebocoran yang ditutup #142.
 */
export function HasilBanner({
  nada,
  teks,
  detikHilang = 6,
}: {
  nada: "ok" | "gagal";
  teks: string;
  detikHilang?: number;
}) {
  const [tampil, setTampil] = useState(true);

  useEffect(() => {
    // Buang `?h=` dari URL supaya REFRESH tidak memunculkan hasil aksi LAMA —
    // banner basi adalah keyakinan salah, kelas yang sama dgn alasan banner ini ada.
    const u = new URL(window.location.href);
    if (u.searchParams.has("h")) {
      u.searchParams.delete("h");
      window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
    const t = setTimeout(() => setTampil(false), detikHilang * 1000);
    return () => clearTimeout(t);
  }, [detikHilang]);

  if (!tampil) return null;
  const warna = nada === "ok" ? "var(--success)" : "var(--danger)";

  return (
    <div
      role="status"
      aria-live="polite"
      data-hasil={nada}
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(680px, calc(100vw - 32px))",
        padding: "12px 18px",
        borderRadius: 10,
        border: `2px solid ${warna}`,
        background: "var(--surface, #fff)",
        boxShadow: "0 6px 24px rgba(0,0,0,.18)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span className="fs16" style={{ color: warna }}>
        {nada === "ok" ? "✓ " : "⚠️ "}
        {teks}
      </span>
      <button
        type="button"
        onClick={() => setTampil(false)}
        aria-label="Tutup pemberitahuan"
        className="btn-outline sm"
        style={{ marginLeft: "auto" }}
      >
        Tutup
      </button>
    </div>
  );
}
