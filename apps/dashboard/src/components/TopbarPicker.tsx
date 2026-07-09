"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DATE_COOKIE, UNIT_COOKIE } from "@/lib/selection-keys";
import { writeSelectionCookie } from "./useSelection";

export interface UnitOpt {
  code: string;
  label: string;
}

/**
 * Pemilih unit + tanggal bisnis TUNGGAL di topbar. Nilai TAMPIL sudah
 * diresolusi AppShell lewat useSelection (URL kanonik; cookie hanya default
 * titik-masuk) — komponen ini presentasional + navigasi sadar-rute. Di layar
 * tanpa unit di URL (board/ketaatan/beranda) ganti pilihan hanya menulis
 * cookie + refresh.
 */
export function TopbarPicker({
  units,
  unit,
  date,
}: {
  units: UnitOpt[];
  unit?: string;
  date: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const isDenah = path.startsWith("/monitoring/denah");

  const baseUnit = unit ?? units[0]?.code ?? "";

  const apply = (nextUnit: string, nextDate: string) => {
    writeSelectionCookie(UNIT_COOKIE, nextUnit);
    // Denah tak berdimensi tanggal (input nonaktif, tampil hari ini) — jangan
    // timpa tanggal terbawa di cookie dari sini.
    if (!isDenah) writeSelectionCookie(DATE_COOKIE, nextDate);
    if (/^\/unit\/[^/]+\/laporan\//.test(path)) {
      const v = sp.get("view");
      router.push(`/unit/${nextUnit}/laporan/${nextDate}${v ? `?view=${v}` : ""}`);
    } else if (/^\/unit\/[^/]+\/rincian\//.test(path)) {
      const k = sp.get("kosong");
      router.push(`/unit/${nextUnit}/rincian/${nextDate}${k ? `?kosong=${k}` : ""}`);
    } else if (/^\/unit\/[^/]+\/usulan\//.test(path)) {
      // Pertahankan sub-rute /edit (form) vs daftar saat ganti unit/tanggal.
      const edit = /\/usulan\/[^/]+\/edit/.test(path) ? "/edit" : "";
      router.push(`/unit/${nextUnit}/usulan/${nextDate}${edit}`);
    } else if (isDenah) {
      router.push(`/monitoring/denah/${nextUnit}`);
    } else {
      // board / ketaatan / beranda: seed terbawa, render ulang konteks.
      router.refresh();
    }
  };

  return (
    <div className="topbar-picker">
      <select
        className="select sm"
        value={baseUnit}
        onChange={(e) => apply(e.target.value, date)}
        aria-label="Pilih unit"
      >
        {units.map((u) => (
          <option key={u.code} value={u.code}>
            {u.label}
          </option>
        ))}
      </select>
      <input
        className="date-input sm"
        type="date"
        value={date}
        onChange={(e) => apply(baseUnit, e.target.value)}
        disabled={isDenah}
        aria-label="Tanggal bisnis"
      />
    </div>
  );
}
