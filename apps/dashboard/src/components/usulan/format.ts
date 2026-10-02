import { fmtKL } from "@/lib/format";

/** Empat kolom DO di form saja; konversi/3 desimal tetap milik fmtKL.
 *  Pangkas nol desimal dari TEKS hasil format, tanpa mengubah angka atau ekspor. */
export const formatUsulanKl = (liters: number): string =>
  fmtKL(liters, 3).replace(/,(\d*?)0+(?= KL$)/, (_, fraction: string) =>
    fraction ? `,${fraction}` : "",
  );
