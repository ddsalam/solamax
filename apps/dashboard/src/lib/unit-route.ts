/**
 * Pembangun URL rute per-unit — MURNI (tanpa import server/next) agar teruji
 * langsung. Dipakai oleh filter MILIK HALAMAN (UnitDateFilters) menggantikan
 * regex navigasi yang dulu tertanam di TopbarPicker.
 *
 * Catatan batas: berkas ini hanya MEMBANGUN URL. Semantik PARSING tetap milik
 * `selection-keys.ts` (regex rute untuk cermin picker) dan tidak disentuh —
 * itulah berkas yang jadi akar bug desync (PR #73).
 */

/**
 * Rute yang dipilihkan unit/tanggalnya oleh `UnitDateFilters`.
 *
 * ⛔ SATU pembangun URL untuk SEMUANYA, meski bentuk rutenya berbeda-beda —
 * ada yang membawa unit di PATH, satu yang membawanya di QUERY, dan satu yang
 * tak punya dimensi unit sama sekali. Membuat pembangun kedua untuk keluarga
 * keuangan berarti dua tempat yang menjawab "ke mana tombol ini pergi", dan
 * mereka akan menjawab berbeda pada hari mereka berbeda.
 */
export type UnitRouteSegment =
  | "rincian"
  | "laporan"
  | "usulan"
  | "denah"
  // Keuangan — unit di PATH, di bawah /keuangan/unit/<code>/…
  | "keuangan-laporan"
  | "keuangan-input"
  | "keuangan-tutup-hari"
  | "keuangan-akun-kas"
  // Keuangan — unit di QUERY (?unit=), sebab halamannya bukan rute per-unit
  | "keuangan-sumber-data"
  // Keuangan — TANPA dimensi unit: papan menampilkan SEMUA unit sekaligus
  | "keuangan-papan";

export function unitRouteHref(args: {
  segment: UnitRouteSegment;
  code: string;
  /** Wajib untuk segmen ber-tanggal; diabaikan untuk `denah` (realtime). */
  date?: string;
  /** Sub-rute form usulan (`/edit`) — dipertahankan saat unit/tanggal berganti. */
  edit?: boolean;
  /** Query string yang dipertahankan apa adanya, TANPA `?` (mis. `view=ringkas`). */
  query?: string;
}): string {
  const { segment, code, date, edit, query } = args;
  const suffix = query ? `?${query}` : "";
  if (segment === "denah") return `/monitoring/denah/${code}${suffix}`;

  // ── Keuangan ──────────────────────────────────────────────────────────────
  // Bentuk rutenya TIDAK seragam dengan keluarga lama, dan itu disebut di sini
  // apa adanya alih-alih dipaksa seragam: memindahkan rute yang sudah hidup di
  // produksi adalah perubahan yang jauh lebih besar dari sebuah pemilih.
  if (segment === "keuangan-laporan") return `/keuangan/unit/${code}/${date}${suffix}`;
  if (segment === "keuangan-input") return `/keuangan/unit/${code}/${date}/input${suffix}`;
  if (segment === "keuangan-tutup-hari") {
    return `/keuangan/unit/${code}/tutup-hari/${date}${suffix}`;
  }
  // Tanpa dimensi tanggal — daftar rekening bukan keadaan harian.
  if (segment === "keuangan-akun-kas") return `/keuangan/unit/${code}/akun-kas${suffix}`;
  // Unit di QUERY: halaman ini membaca `?unit=`, bukan segmen path.
  if (segment === "keuangan-sumber-data") {
    return `/keuangan/sumber-data?${qs({ unit: code, tanggal: date, lain: query })}`;
  }
  // TANPA unit: papan menampilkan semua unit; hanya tanggal yang berarti.
  if (segment === "keuangan-papan") {
    return `/keuangan${date ? `?${qs({ tanggal: date, lain: query })}` : suffix}`;
  }

  const edt = segment === "usulan" && edit ? "/edit" : "";
  return `/unit/${code}/${segment}/${date}${edt}${suffix}`;
}

/** Rakit query string; nilai kosong dibuang, `lain` dipertahankan apa adanya. */
function qs(a: { unit?: string; tanggal?: string; lain?: string }): string {
  const p = new URLSearchParams(a.lain ?? "");
  if (a.unit !== undefined) p.set("unit", a.unit);
  if (a.tanggal !== undefined) p.set("tanggal", a.tanggal);
  return p.toString();
}
