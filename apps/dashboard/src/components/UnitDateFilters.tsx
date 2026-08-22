"use client";

/**
 * Filter MILIK HALAMAN untuk rute per-unit (rincian / laporan / usulan / denah).
 *
 * Menggantikan picker global di topbar. Prinsipnya sama dengan BoardFilters &
 * HarianFilters — komponen ini hanya MEMBANGUN URL; URL tetap satu-satunya
 * sumber kebenaran halaman, dan otorisasi unit tetap di server (requireUnit →
 * notFound). Tidak ada cookie yang ditulis dari sini: cookie "unit/tanggal
 * terakhir dipakai" digeser oleh write-through navigasi (useSelection), jadi
 * seed titik-masuk tetap ikut tanpa jadi kendali kedua.
 *
 * Hanya dimensi yang BENAR-BENAR dipakai halaman yang dirender:
 *   - denah realtime → unit saja + teks konteks (tanpa kontrol tanggal);
 *   - scope 1 unit  → dimensi unit degenerate → chip konteks, bukan dropdown.
 *
 * PEMILIHAN ≠ PENERAPAN (temuan review owner). Versi pertama memakai grup
 * `radio` yang bernavigasi pada `change`: pada grup radio native, tombol PANAH
 * memindahkan fokus SEKALIGUS mengubah pilihan → satu tekan panah = satu muat
 * halaman penuh + satu entri history, sehingga daftar unit MUSTAHIL disusuri
 * dengan keyboard. Sekarang tiap unit adalah TAUTAN: panah/Tab hanya memindah
 * fokus (nol navigasi), dan hanya aktivasi eksplisit (klik / Enter) yang
 * berpindah. Bonus dari anchor sungguhan: unit lain bisa dibuka di tab baru
 * (⌘/ctrl-klik) — konsisten dengan "URL adalah sumber kebenaran".
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { addDays } from "@/lib/periods";
import { unitRouteHref, type UnitRouteSegment } from "@/lib/unit-route";

export interface FilterUnitOpt {
  code: string;
  name: string;
  dotted: string;
}

export function UnitDateFilters({
  units,
  code,
  segment,
  edit,
  date,
  today,
  maxDate,
  note,
  dimensiUnit = "pilih",
}: {
  /** Unit dalam scope caller (dari getDataScope) — daftar pilihan. */
  units: FilterUnitOpt[];
  /** Unit aktif (dari path — kanonik). */
  code: string;
  segment: UnitRouteSegment;
  /** true = sedang di form usulan (`/edit`); sub-rute dipertahankan. */
  edit?: boolean;
  /** Tanggal bisnis aktif. Absen = halaman tanpa dimensi tanggal. */
  date?: string;
  /** Hari ini WIB dari server — target tombol "Hari ini". */
  today?: string;
  /**
   * Batas atas pemilih tanggal. Sengaja OPSIONAL: laporan/rincian melaporkan
   * masa lalu (tak ada data besok → dibatasi hari ini), sedangkan Usulan
   * Penebusan adalah RENCANA dan sejak dulu boleh diberi tanggal ke depan —
   * membatasinya di sini akan diam-diam mengubah alur kerja, bukan tampilan.
   */
  maxDate?: string;
  /** Teks konteks singkat di ujung baris (mis. penjelasan realtime). */
  note?: string;
  /**
   * Dimensi unit halaman ini.
   *
   * ⛔ `"tak_berlaku"` BUKAN sama dengan "satu unit". Papan keuangan grup
   * menampilkan **semua** unit dalam scope sekaligus, jadi pemilih unit di sana
   * adalah kontrol yang **tak mengubah apa pun** — dan kontrol yang tak
   * mengubah apa pun mengajari orang bahwa kontrol di halaman ini tak berarti.
   * Yang berarti di sana hanya TANGGAL.
   */
  dimensiUnit?: "pilih" | "tak_berlaku";
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const optRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const query = sp.toString();
  /** Hanya untuk kontrol TANGGAL; unit berpindah lewat <Link> (lihat di atas). */
  const navDate = (nextDate: string) => {
    router.push(unitRouteHref({ segment, code, date: nextDate, edit, query }));
  };

  const activeIndex = units.findIndex((u) => u.code === code);
  const active = activeIndex >= 0 ? units[activeIndex] : undefined;
  const activeLabel = active?.name ?? code;

  const shift = (days: number) => {
    if (!date) return;
    const next = addDays(date, days);
    if (maxDate && next > maxDate) return;
    navDate(next);
  };

  const closePicker = (refocus: boolean) => {
    const d = detailsRef.current;
    if (!d?.open) return;
    d.open = false;
    if (refocus) summaryRef.current?.focus();
  };

  const focusOpt = (i: number) => {
    const list = optRefs.current.filter((el): el is HTMLAnchorElement => el !== null);
    if (list.length === 0) return;
    list[((i % list.length) + list.length) % list.length]?.focus();
  };

  /**
   * Navigasi keyboard di dalam picker — MEMINDAH FOKUS SAJA, tak pernah pindah
   * halaman. Esc menutup tanpa navigasi; Shift+Tab keluar begitu saja (tak ada
   * handler blur yang "menerapkan" diam-diam).
   */
  const onPickerKeyDown = (e: React.KeyboardEvent<HTMLDetailsElement>) => {
    const d = detailsRef.current;
    if (!d) return;
    if (e.key === "Escape") {
      if (!d.open) return;
      e.preventDefault();
      closePicker(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault(); // jangan menggulir halaman
    if (!d.open) d.open = true;
    const list = optRefs.current.filter((el): el is HTMLAnchorElement => el !== null);
    const cur = list.indexOf(document.activeElement as HTMLAnchorElement);
    // Dari summary (fokus belum di daftar): masuk ke unit yang sedang aktif.
    if (cur === -1) focusOpt(e.key === "ArrowDown" ? Math.max(activeIndex, 0) : list.length - 1);
    else focusOpt(cur + (e.key === "ArrowDown" ? 1 : -1));
  };

  return (
    <>
    {/* Bilah sticky = KONTROL saja. Teks penjelas ditaruh di bawahnya (ikut
        tergulung) agar tinggi bilah tetap satu baris di semua lebar — mengukur
        di 1440..800px menunjukkan teks penjelas di dalam bilahlah yang membuat
        chrome permanen justru MEMBENGKAK di bawah ~1280px. */}
    <div className="board-filters filters-sticky no-print" role="group" aria-label="Filter halaman">
      {dimensiUnit === "tak_berlaku" ? (
        <span className="fs16 t-secondary" data-dimensi-unit="tak-berlaku">
          Semua unit dalam cakupan Anda ({units.length})
        </span>
      ) : units.length > 1 ? (
        <details ref={detailsRef} className="unit-picker" onKeyDown={onPickerKeyDown}>
          <summary ref={summaryRef} className="btn-outline unit-picker-btn">
            <span className="fs15 t-tertiary">Unit</span>
            <span className="fs16 w600">{activeLabel}</span>
            <span className="t-tertiary">▾</span>
          </summary>
          <div className="unit-picker-panel card" role="group" aria-label="Pilih unit">
            {units.map((u, i) => (
              <Link
                key={u.code}
                ref={(el) => {
                  optRefs.current[i] = el;
                }}
                href={unitRouteHref({ segment, code: u.code, date, edit, query })}
                className="unit-picker-row unit-picker-opt"
                aria-current={u.code === code ? "true" : undefined}
                onClick={() => closePicker(false)}
              >
                <span className="unit-picker-mark" aria-hidden="true">
                  {u.code === code ? "✓" : ""}
                </span>
                <span className="fs16 t-primary">{u.name}</span>
                <span className="fs15 t-tertiary mono">{u.dotted}</span>
              </Link>
            ))}
          </div>
        </details>
      ) : (
        // Satu unit dalam scope: tak ada yang bisa dipilih — tampilkan konteks,
        // bukan kontrol yang tak pernah mengubah apa pun.
        <span className="filter-static">
          <span className="fs15 t-tertiary">Unit</span>
          <span className="fs16 w600 t-primary">{activeLabel}</span>
          {active && <span className="fs15 t-tertiary mono">{active.dotted}</span>}
        </span>
      )}

      {date && (
        <div className="range-inputs">
          <label htmlFor="filter-date" className="fs15 t-tertiary">
            Tanggal
          </label>
          <button
            type="button"
            className="btn-outline"
            onClick={() => shift(-1)}
            aria-label="Hari sebelumnya"
          >
            ‹
          </button>
          <input
            id="filter-date"
            type="date"
            value={date}
            max={maxDate}
            onChange={(e) => e.target.value && navDate(e.target.value)}
          />
          <button
            type="button"
            className="btn-outline"
            onClick={() => shift(1)}
            disabled={maxDate !== undefined && date >= maxDate}
            aria-label="Hari berikutnya"
          >
            ›
          </button>
          {today !== undefined && date !== today && (
            <button type="button" className="btn-tint sm" onClick={() => navDate(today)}>
              Hari ini
            </button>
          )}
        </div>
      )}

    </div>
    {note && <p className="filter-note fs15 t-tertiary no-print">{note}</p>}
    </>
  );
}
