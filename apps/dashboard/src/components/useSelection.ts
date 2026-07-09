"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { todayWib } from "@/lib/periods";
import {
  DATE_COOKIE,
  DATE_RE,
  deriveTopbarSelection,
  SELECTION_MAX_AGE,
  selectionCookieWrites,
  UNIT_COOKIE,
} from "@/lib/selection-keys";

/**
 * Resolusi pilihan unit+tanggal di sisi CLIENT — satu tempat untuk topbar &
 * sidebar (dipanggil AppShell). URL kanonik lewat deriveTopbarSelection; di
 * rute tanpa unit di URL, seed = cookie TERBARU dibaca client pasca-mount
 * (prop layout server bisa basi karena layout tak re-render pada navigasi
 * lunak) → render awal tetap pakai prop server (hydration-safe).
 *
 * Efek write-through: tiap rute ber-unit-di-URL menyalin unit (dan tanggal,
 * bila ada di URL) ke cookie — drill-in/bookmark/back-forward ikut menggeser
 * "unit terakhir dipakai". Validasi scope: hanya kode dalam `unitCodes`.
 *
 * Multi-tab: cookie dibagi antar tab → tab unit yang terbuka merebut kembali
 * "unit terakhir" tiap auto-refresh (last-writer-wins). DISENGAJA & aman:
 * tampilan tak pernah desync (URL kanonik); hanya seed rute tanpa-unit yang
 * mengikuti tab yang terakhir aktif.
 */

function readCookie(name: string): string | undefined {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
}

export function writeSelectionCookie(key: string, value: string): void {
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${SELECTION_MAX_AGE}; samesite=lax`;
}

export function useSelection(
  unitCodes: string[],
  seedUnit: string | undefined,
  seedDate: string,
): { unit: string | undefined; date: string; navDate: string } {
  const path = usePathname();
  const [seed, setSeed] = useState({ unit: seedUnit, date: seedDate });

  useEffect(() => {
    // Cookie terbaru menang atas prop layout (yang bisa basi); validasi sama
    // dengan getSelection server: unit harus dalam scope, tanggal harus valid.
    const rawUnit = readCookie(UNIT_COOKIE);
    const rawDate = readCookie(DATE_COOKIE);
    const cur = {
      unit: rawUnit && unitCodes.includes(rawUnit) ? rawUnit : seedUnit,
      date: rawDate && DATE_RE.test(rawDate) ? rawDate : seedDate,
    };
    const sel = deriveTopbarSelection(path, cur.unit, cur.date, todayWib());
    for (const w of selectionCookieWrites(sel, unitCodes, cur)) {
      writeSelectionCookie(w.key, w.value);
    }
    const next = {
      unit: sel.unitFromUrl && sel.unit && unitCodes.includes(sel.unit) ? sel.unit : cur.unit,
      date: sel.dateFromUrl ? sel.date : cur.date,
    };
    setSeed((prev) => (prev.unit === next.unit && prev.date === next.date ? prev : next));
  }, [path, unitCodes, seedUnit, seedDate]);

  const sel = deriveTopbarSelection(path, seed.unit, seed.date, todayWib());
  // Unit URL di luar scope (halamannya toh 404 via requireUnit) → jangan coba
  // tampilkan kode yang tak ada di daftar opsi; jatuh ke seed ter-validasi.
  const unit =
    sel.unitFromUrl && sel.unit && !unitCodes.includes(sel.unit) ? seed.unit : sel.unit;
  // date = TAMPIL (denah → hari ini); navDate = terbawa untuk link navigasi
  // (detour lewat denah tak menghapus tanggal laporan yang sedang ditelusuri).
  return { unit, date: sel.date, navDate: sel.navDate };
}
