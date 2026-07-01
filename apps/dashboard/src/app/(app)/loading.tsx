import { Spinner } from "@/components/loading/Spinner";

/**
 * Fallback rute GENERIK untuk grup (app) — baseline netral, BUKAN skeleton
 * khusus. Muncul instan secara DOM tapi opacity-nya baru naik setelah ~250 ms
 * (animasi murni-CSS .route-fallback) → navigasi non-pilot yang cepat tak
 * berkedip (rule 3). Zero-shift: selalu memesan min-height & memusatkan; hanya
 * opacity berubah. Segmen pilot punya skeleton sendiri yang MENG-OVERRIDE ini
 * dan tampil INSTAN (skeleton = obat layar-beku).
 */
export default function AppLoading() {
  return (
    <div className="route-fallback">
      <Spinner size="lg" label="Memuat halaman" />
      <span className="route-fallback-msg">Memuat…</span>
    </div>
  );
}
