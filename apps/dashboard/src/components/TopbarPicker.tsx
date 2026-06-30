"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DATE_COOKIE,
  deriveTopbarSelection,
  SELECTION_MAX_AGE,
  UNIT_COOKIE,
} from "@/lib/selection-keys";

export interface UnitOpt {
  code: string;
  label: string;
}

/**
 * Pemilih unit + tanggal bisnis TUNGGAL di topbar — terbawa antar layar via
 * cookie (seed) + navigasi sadar-rute. Path tetap otoritatif untuk
 * laporan/rincian (query view/kosong dipertahankan). Di layar grup-wide
 * (board/ketaatan/beranda) hanya menulis cookie + refresh.
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

  // Di rute laporan, nilai TAMPIL cermin URL (otoritatif), bukan prop cookie basi.
  const { unit: curUnit, date: curDate } = deriveTopbarSelection(path, unit, date);
  const baseUnit = curUnit ?? units[0]?.code ?? "";

  const writeCookie = (key: string, value: string) => {
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${SELECTION_MAX_AGE}; samesite=lax`;
  };

  const apply = (nextUnit: string, nextDate: string) => {
    writeCookie(UNIT_COOKIE, nextUnit);
    writeCookie(DATE_COOKIE, nextDate);
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
        onChange={(e) => apply(e.target.value, curDate)}
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
        value={curDate}
        onChange={(e) => apply(baseUnit, e.target.value)}
        disabled={isDenah}
        aria-label="Tanggal bisnis"
      />
    </div>
  );
}
