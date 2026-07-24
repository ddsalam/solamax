/**
 * Fan-out TERBATAS untuk query per-unit — murni, tanpa dependensi.
 *
 * Kenapa ada: pool `pg` dibatasi `max: 5` (db.ts, dihitung terhadap cap koneksi
 * Cloud SQL). Menembakkan `Promise.all` atas 7 unit sekaligus — dan tiap
 * `getDailyGlWindow` sendiri memecah jendelanya jadi 2 query (prefiks ter-cache
 * + sufiks segar) — menuntut sampai 14 koneksi serentak, jauh di atas 5.
 * Kelebihannya mengantre di pool dengan `connectionTimeoutMillis: 10_000`; itu
 * bentuk beban yang persis meledak jadi 504 pada insiden saturasi 30 Juni.
 *
 * `mapLimit` menjaga paling banyak `limit` tugas berjalan, MEMPERTAHANKAN urutan
 * hasil sesuai urutan masukan (urutan unit di UI tak boleh bergantung pada siapa
 * yang selesai duluan).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
