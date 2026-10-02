import { fmtKL } from "@/lib/format";

/** Empat kolom DO: layar, daftar/cetak, dan PDF memakai format yang sama.
 *  null = belum diisi; 0 tetap terlihat. Konversi/3 desimal tetap milik fmtKL;
 *  hanya nol desimal di TEKS yang dipangkas, bukan nilai sumber. */
export const formatUsulanKl = (liters: number | null): string =>
  liters === null ? "" : fmtKL(liters, 3).replace(/,(\d*?)0+(?= KL$)/, (_, fraction: string) =>
    fraction ? `,${fraction}` : "",
  );
