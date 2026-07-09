/**
 * Nama cookie pilihan unit+tanggal terbawa. File ini SENGAJA tanpa import
 * server (mis. next/headers) agar aman diimpor dari komponen client
 * (TopbarPicker) maupun server (selection.ts).
 */
export const UNIT_COOKIE = "solamax.unit";
export const DATE_COOKIE = "solamax.date";

/** Umur cookie (detik) — 30 hari. */
export const SELECTION_MAX_AGE = 60 * 60 * 24 * 30;

/** Format tanggal bisnis di cookie & URL. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const REPORT_ROUTE_RE = /^\/unit\/([^/]+)\/(?:laporan|rincian|usulan)\/(\d{4}-\d{2}-\d{2})/;
const DENAH_ROUTE_RE = /^\/monitoring\/denah\/([^/]+)/;

export interface TopbarSelection {
  unit: string | undefined;
  /** Tanggal TAMPIL di picker (denah realtime → hari ini). */
  date: string;
  /**
   * Tanggal untuk NAVIGASI (link sidebar/hub): tanggal terbawa — di denah
   * tetap tanggal seed (bukan hari ini), agar detour lewat denah TIDAK
   * menghapus tanggal laporan yang sedang ditelusuri pengguna.
   */
  navDate: string;
  /** true = unit datang dari segmen URL (rute per-unit) — URL otoritatif. */
  unitFromUrl: boolean;
  /** true = tanggal datang dari segmen URL — boleh di-write-through ke cookie. */
  dateFromUrl: boolean;
}

/**
 * Sumber nilai TAMPIL picker unit+tanggal — URL KANONIK. Di SEMUA rute yang
 * membawa unit di path (laporan/rincian/usulan + denah) picker WAJIB cermin
 * URL, BUKAN cookie/seed; cookie hanya default titik-masuk tanpa unit di URL
 * (beranda/board/ketaatan). (Akar bug: layout grup `(app)` tak re-render saat
 * navigasi lunak → prop cookie basi → `<input value>` controlled tetap basi →
 * desync. `usePathname()` berubah tiap navigasi → komponen client re-render
 * dgn nilai segar walau layout server tidak.)
 *
 * Denah realtime: tak punya dimensi tanggal → tampilkan `today`, dan
 * dateFromUrl=false agar cookie tanggal terbawa TIDAK ditimpa dari denah.
 */
export function deriveTopbarSelection(
  path: string,
  seedUnit: string | undefined,
  seedDate: string,
  today: string,
): TopbarSelection {
  const r = REPORT_ROUTE_RE.exec(path);
  if (r) return { unit: r[1], date: r[2]!, navDate: r[2]!, unitFromUrl: true, dateFromUrl: true };
  const d = DENAH_ROUTE_RE.exec(path);
  if (d) return { unit: d[1], date: today, navDate: seedDate, unitFromUrl: true, dateFromUrl: false };
  return { unit: seedUnit, date: seedDate, navDate: seedDate, unitFromUrl: false, dateFromUrl: false };
}

/**
 * Write-through: cookie "unit terakhir dipakai" mengikuti navigasi (drill-in,
 * bookmark, back/forward), bukan hanya aksi picker. Murni agar teruji: nilai
 * di luar scope caller TIDAK ditulis (cookie tak pernah bisa menunjuk unit
 * asing), nilai sama = tanpa tulisan (hindari loop efek).
 */
export function selectionCookieWrites(
  sel: TopbarSelection,
  unitCodes: string[],
  current: { unit?: string; date?: string },
): Array<{ key: string; value: string }> {
  // Unit URL di luar scope caller → halaman 404 via requireUnit; URL 404 tak
  // boleh menggeser seed terbawa SAMA SEKALI (unit maupun tanggal).
  if (sel.unitFromUrl && (!sel.unit || !unitCodes.includes(sel.unit))) return [];
  const writes: Array<{ key: string; value: string }> = [];
  if (sel.unitFromUrl && sel.unit && current.unit !== sel.unit) {
    writes.push({ key: UNIT_COOKIE, value: sel.unit });
  }
  if (sel.dateFromUrl && DATE_RE.test(sel.date) && current.date !== sel.date) {
    writes.push({ key: DATE_COOKIE, value: sel.date });
  }
  return writes;
}
