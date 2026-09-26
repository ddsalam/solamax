import { teksTerbaca, type HasilAngka } from "@/lib/angka-input";

/**
 * Baris di bawah kolom angka: "Terbaca: Rp 1.500.000", atau pesan penolakan.
 *
 * Yang dilihat penulis sebelum menekan Simpan adalah ANGKA YANG AKAN TERSIMPAN,
 * bukan yang ia kira ia ketik. Salah ketik seratus kali lipat terlihat di sini,
 * bukan sebulan kemudian di neraca.
 */
export function PratinjauAngka({
  hasil,
  satuan = "rupiah",
}: {
  hasil: HasilAngka;
  satuan?: "rupiah" | "per_liter";
}) {
  if (hasil.keadaan === "kosong") return null;
  if (hasil.keadaan === "tolak") {
    return (
      <span className="fs16 t-danger keu-terbaca" role="alert">
        {hasil.pesan}
      </span>
    );
  }
  return (
    <span className="fs16 t-secondary keu-terbaca num" aria-live="polite">
      {teksTerbaca(hasil, satuan)}
    </span>
  );
}
