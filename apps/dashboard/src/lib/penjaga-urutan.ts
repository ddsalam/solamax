/**
 * Pemeriksa URUTAN untuk penjaga teks — dan penawar satu kelas cacat yang
 * ditemukan uji mutasi pada penjaga saya sendiri (16 Agustus 2026).
 *
 * ⛔ **`indexOf(a) < indexOf(b)` LOLOS justru ketika `a` TIDAK ADA.**
 * `indexOf` mengembalikan `-1`, dan `-1` selalu lebih kecil dari indeks apa
 * pun. Jadi penjaga yang berbunyi "gerbang harus mendahului koneksi" tetap
 * HIJAU setelah gerbangnya **dihapus seluruhnya** — ia bahkan jadi "lebih
 * benar" menurut asersinya sendiri.
 *
 * Ini keluarga yang sama dengan "tidak ada keluaran ≠ sinyal": pemeriksaan yang
 * hijau karena subjeknya lenyap. Bedanya, di sini lenyapnya subjek justru
 * membuat perbandingannya lulus, bukan sekadar kosong.
 *
 * Aturannya: urutan hanya berarti bila KEDUA hal itu ADA. Fungsi di bawah
 * menuntut keduanya lebih dulu, lalu barulah membandingkan.
 */

export type HasilUrutan =
  | { ok: true }
  | { ok: false; sebab: "awal_hilang" | "akhir_hilang" | "terbalik"; pesan: string };

/**
 * `awal` harus ADA, `akhir` harus ADA, dan `awal` harus muncul lebih dulu.
 *
 * Ketiganya dibedakan supaya pesan gagalnya menyebut yang sebenarnya terjadi —
 * "gerbangnya hilang" dan "gerbangnya kesorean" menuntut perbaikan berbeda.
 */
export function mendahului(teks: string, awal: string, akhir: string): HasilUrutan {
  const i = teks.indexOf(awal);
  const j = teks.indexOf(akhir);
  if (i < 0) {
    return { ok: false, sebab: "awal_hilang", pesan: `"${awal}" tidak ditemukan sama sekali` };
  }
  if (j < 0) {
    return { ok: false, sebab: "akhir_hilang", pesan: `"${akhir}" tidak ditemukan sama sekali` };
  }
  if (i >= j) {
    return { ok: false, sebab: "terbalik", pesan: `"${awal}" muncul SESUDAH "${akhir}"` };
  }
  return { ok: true };
}

/** Bentuk yang enak dipakai di `expect(...)`: `"ok"` atau pesan gagalnya. */
export function urutan(teks: string, awal: string, akhir: string): string {
  const h = mendahului(teks, awal, akhir);
  return h.ok ? "ok" : h.pesan;
}
