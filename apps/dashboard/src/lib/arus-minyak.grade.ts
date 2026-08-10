/**
 * PENILAI Arus Minyak vs oracle EasyMax — murni, tanpa React/DB/IO.
 *
 * Dipisah dari harness live (`arus-minyak.render.test.tsx`) karena bagian PALING
 * RAWAN dari perbandingan itu bukan angkanya, melainkan **cara ia memperlakukan
 * baris yang TIDAK ADA**. Baris produk mati (Premium) memang sengaja tak
 * dirender (keputusan owner: baris digerakkan data), jadi penilai harus memberi
 * nilai pada ketiadaan — dan di situlah pemeriksaan bisa lulus JUSTRU karena tak
 * ada yang diperiksa.
 *
 * Aturannya: baris absen hanya boleh diskor `absen_nol` bila SELURUH sel
 * oracle-nya nol. Absen dengan satu saja sel oracle bukan-nol = `mismatch`
 * (angka HILANG), bukan "cocok". Diskriminasi itu diuji di `arus-minyak.test.ts`
 * yang jalan di SETIAP commit — tanpa perlu DB — supaya tidak bergantung pada
 * seseorang mengingat untuk menjalankan mutasi manual.
 *
 * Modul ini TIDAK dipakai aplikasi; hanya perkakas verifikasi.
 */

export type Vonis = "eksak" | "deviasi_sah" | "absen_nol" | "oracle_overflow" | "mismatch";

export interface SelHasil {
  tanggal: string;
  baris: string;
  kolom: string;
  oracle: number;
  render: number | null | undefined;
  vonis: Vonis;
  catatan?: string;
}

export interface DeviasiSah {
  /** indeks kolom (0-based) yang boleh menyimpang */
  kolom: number;
  /** nilai yang DIHARAPKAN dari SolaMax — bukan "apa pun boleh" */
  nilai: number;
  sebab: string;
}

/** Toleransi tampilan: 2 desimal → setengah digit terakhir. */
const EPS = 0.005;

/**
 * Lebar maksimum kolom % di laporan EasyMax. Nilai yang lebih panjang dicetak
 * `***,**` — bukan nilai, melainkan pengakuan bahwa kolomnya tak muat.
 * Diukur dari data: −742,52 (7 karakter) overflow; 184,69 dan −30,38 (6) tidak.
 */
export const LEBAR_KOLOM_PCT = 6;

/** Oracle mencetak `***,**` → tulis NaN di fixture. Bukan nilai, bukan nol. */
export const OVERFLOW = NaN;

/**
 * @param oracle  tanggal → nama baris → 7 sel
 * @param render  tanggal → nama baris → 7 sel (null = "—", undefined = baris absen)
 * @param deviasi kunci `"<tanggal>|<baris>"` → pengecualian BERNAMA
 */
export function gradeArus(
  oracle: Record<string, Record<string, number[]>>,
  render: Record<string, Map<string, (number | null)[]>>,
  kolom: string[],
  deviasi: Record<string, DeviasiSah> = {},
): SelHasil[] {
  const out: SelHasil[] = [];
  for (const [tanggal, barisOracle] of Object.entries(oracle)) {
    const hariRender = render[tanggal];
    for (const [baris, sel] of Object.entries(barisOracle)) {
      const got = hariRender?.get(baris);
      const dev = deviasi[`${tanggal}|${baris}`];
      for (const [i, want] of sel.entries()) {
        const kol = kolom[i] ?? `kolom-${i}`;
        if (got === undefined) {
          // Baris tidak dirender. SATU-SATUNYA alasan yang sah: baris mati
          // (seluruh sel oracle nol). Selain itu = angka hilang.
          const seluruhNol = sel.every((x) => x === 0);
          out.push({
            tanggal,
            baris,
            kolom: kol,
            oracle: want,
            render: undefined,
            vonis: seluruhNol ? "absen_nol" : "mismatch",
            catatan: seluruhNol ? "baris mati — TOTAL tak berubah" : "baris ABSEN dari render",
          });
          continue;
        }
        const g = got[i];
        // Sel yang oracle-nya sendiri menolak mencetak nilai (`***,**`).
        // TIDAK dihitung EKSAK. Yang diperiksa: apakah nilai SolaMax memang
        // terlalu panjang untuk kolom itu — kalau ternyata pendek, berarti
        // sebabnya bukan overflow dan ini mismatch sungguhan.
        if (Number.isNaN(want)) {
          const lebar = g === null || g === undefined ? 0 : idnLebar(g);
          out.push({
            tanggal,
            baris,
            kolom: kol,
            oracle: want,
            render: g,
            vonis: lebar > LEBAR_KOLOM_PCT ? "oracle_overflow" : "mismatch",
            catatan: `oracle mencetak ***,** (kolom ${LEBAR_KOLOM_PCT} karakter); SolaMax ${g} butuh ${lebar}`,
          });
          continue;
        }
        if (dev && dev.kolom === i) {
          out.push({
            tanggal,
            baris,
            kolom: kol,
            oracle: want,
            render: g,
            vonis: g != null && Math.abs(g - dev.nilai) < EPS ? "deviasi_sah" : "mismatch",
            catatan: dev.sebab,
          });
          continue;
        }
        out.push({
          tanggal,
          baris,
          kolom: kol,
          oracle: want,
          render: g,
          vonis: g != null && Math.abs(g - want) < EPS ? "eksak" : "mismatch",
        });
      }
    }
  }
  return out;
}

/** Lebar cetak gaya id-ID: 2 desimal, pemisah ribuan titik, koma desimal. */
export function idnLebar(n: number): number {
  return n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length;
}

export function ringkas(hasil: SelHasil[]): Record<Vonis, number> & { total: number } {
  const r = { eksak: 0, deviasi_sah: 0, absen_nol: 0, oracle_overflow: 0, mismatch: 0, total: hasil.length };
  for (const h of hasil) r[h.vonis]++;
  return r;
}

/** "18.685,01" → 18685.01 ; "—" → null. */
export function parseIdn(s: string): number | null {
  const t = s.replace(/&#x27;|&nbsp;/g, "").trim();
  if (t === "—" || t === "") return null;
  return Number(t.replace(/\./g, "").replace(",", ".").replace(/−/g, "-"));
}

/** Ekstrak sel dari HTML hasil render — via data-arus-row + isi <span>. */
export function parseArusHtml(html: string): Map<string, (number | null)[]> {
  const out = new Map<string, (number | null)[]>();
  const rowRe =
    /<div class="[^"]*cols-arus"[^>]*data-arus-row="([^"]*)"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|$)/g;
  for (const m of html.matchAll(rowRe)) {
    const cells = [...m[2]!.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((c) =>
      c[1]!.replace(/<[^>]+>/g, ""),
    );
    out.set(m[1]!, cells.slice(1).map(parseIdn)); // sel[0] = nama produk
  }
  return out;
}
