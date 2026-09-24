/**
 * Aturan MURNI untuk pengakuan per-koreksi — sengaja TIDAK di berkas
 * `"use server"`.
 *
 * Berkas server action hanya boleh mengekspor fungsi async; sebuah konstanta
 * atau fungsi sinkron di sana menjatuhkan `next build`. Memisahkannya juga
 * membuat aturannya dapat diuji tanpa menyentuh auth maupun basis data.
 */

/**
 * Batas jumlah peristiwa dalam SATU pengakuan.
 *
 * Bukan batas kinerja. Ia membatasi kerusakan bila muatan dipalsukan: pengakuan
 * adalah tindakan pemilik yang meninggalkan jejak, dan jejak sepanjang ribuan
 * baris dari satu klik tidak lagi bisa ditinjau manusia. Koreksi terbesar yang
 * pernah terjadi di produksi menyentuh 8 tanggal (cut 424, 23-09-2026); cut 206
 * menyentuh 7. Lima puluh memberi ruang lebih dari enam kali tanpa menjadi tak
 * terbatas.
 */
export const MAKS_PERISTIWA_SEKALI_AKUI = 50;

export type PeristiwaDiajukan = { d: string; g: string };

/**
 * Membaca daftar peristiwa yang DITAMPILKAN tombolnya.
 *
 * ⛔ Daftar ini tidak boleh kosong, dan tidak ada bentuk lain yang berarti
 * "semua". Jalur "setujui semua" tidak ada — bukan disembunyikan, memang tidak
 * pernah dibuat.
 */
export function bacaDaftarPeristiwa(raw: string): PeristiwaDiajukan[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("daftar peristiwa tidak valid");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("daftar peristiwa kosong: tidak ada jalur setujui-semua");
  }
  if (parsed.length > MAKS_PERISTIWA_SEKALI_AKUI) {
    throw new Error(`sekali pengakuan dibatasi ${MAKS_PERISTIWA_SEKALI_AKUI} peristiwa`);
  }
  return parsed.map((item) => {
    const d = String((item as PeristiwaDiajukan)?.d ?? "");
    const g = String((item as PeristiwaDiajukan)?.g ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("as_of_date tidak valid");
    if (!/^[0-9a-fA-F-]{36}$/.test(g)) throw new Error("generation_id tidak valid");
    return { d, g };
  });
}
