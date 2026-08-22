/**
 * Pemeriksa ARITAS parameter kueri — **statis, tanpa DB, tanpa skema**.
 *
 * 🔴 KELAS YANG MELAHIRKANNYA (22 Agu 2026, ditemukan owner di PRODUKSI):
 *
 *     bind message supplies 10 parameters, but prepared statement "" requires 11
 *
 * `INSERT app.purchase_price` menyebut 11 kolom dan `$1..$11`, array nilainya
 * berisi 10 — `created_by_user_id` tak pernah dikirim. SETIAP penyimpanan harga
 * beli gagal, dan tak satu pun dari lapisan yang ada bisa melihatnya:
 * type-check tak menghitung placeholder, penjaga nama-tabel melihat nama,
 * penjaga hak-DML melihat hak.
 *
 * Ini saudara ketiga dari keluarga yang sama — `42P01` (tabel tak ada),
 * `42501` (tanpa hak), dan **aritas** — dan yang paling mekanis di antaranya:
 * hitung placeholder tertinggi, bandingkan dengan panjang array.
 *
 * ⚠️ **BATAS YANG DIAKUI, JANGAN DIKIRA LEBIH:**
 *
 * 1. **Ia TIDAK menangkap kolom yang SALAH URUTAN.** Sebelas nilai untuk sebelas
 *    placeholder tetap lolos meski `unit_id` dan `product_id` tertukar. Jumlah
 *    cocok, arti tertukar — dan itu kelas yang hanya bisa dilihat DB atau
 *    manusia, bukan penghitung.
 * 2. **Ia TIDAK menilai kueri yang array-nya disusun dinamis** (spread, `map`,
 *    variabel). Yang begitu **diakui tak dapat dinilai**, dihitung, dan
 *    dilaporkan — bukan didiamkan seolah lolos.
 * 3. **Ia TIDAK menilai SQL yang mengandung interpolasi `${…}`**, sebab
 *    potongan yang disisipkan bisa membawa placeholder yang tak terlihat di
 *    berkas ini.
 */

export interface Panggilan {
  fungsi: string;
  /** Teks argumen apa adanya, sudah dipisah pada koma tingkat-atas. */
  argumen: string[];
  baris: number;
}

const PEMANGGIL = /\b(qScoped|q|client\.query|pool\.query)\s*\(/g;

/**
 * Pindai argumen sebuah pemanggilan dengan **penghitung kedalaman**, bukan
 * regex: regex tak bisa membedakan koma pemisah argumen dari koma di dalam
 * array, objek, atau string.
 */
export function pisahArgumen(src: string, posBuka: number): string[] | null {
  let i = posBuka + 1;
  let depth = 0;
  let arg = "";
  const out: string[] = [];
  let kutip: string | null = null;
  let tmplDepth = 0;

  while (i < src.length) {
    const c = src[i]!;
    const dua = src.slice(i, i + 2);

    if (kutip !== null) {
      arg += c;
      if (c === "\\") {
        arg += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (kutip === "`" && dua === "${") {
        tmplDepth++;
        arg += "{";
        i += 2;
        continue;
      }
      if (kutip === "`" && c === "}" && tmplDepth > 0) tmplDepth--;
      else if (c === kutip && tmplDepth === 0) kutip = null;
      i++;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      kutip = c;
      arg += c;
      i++;
      continue;
    }
    if (dua === "//") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (dua === "/*") {
      const tutup = src.indexOf("*/", i);
      i = tutup < 0 ? src.length : tutup + 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" && depth === 0) {
      out.push(arg);
      return out;
    }
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(arg);
      arg = "";
      i++;
      continue;
    }
    arg += c;
    i++;
  }
  return null; // tak seimbang — sumber tak terbaca, jangan mengarang
}

export function panggilanBerparameter(src: string): Panggilan[] {
  const out: Panggilan[] = [];
  PEMANGGIL.lastIndex = 0;
  for (const m of src.matchAll(PEMANGGIL)) {
    const posBuka = m.index! + m[0].length - 1;
    const argumen = pisahArgumen(src, posBuka);
    if (argumen === null) continue;
    out.push({
      fungsi: m[1]!,
      argumen: argumen.map((a) => a.trim()).filter((a) => a !== ""),
      baris: src.slice(0, m.index!).split("\n").length,
    });
  }
  return out;
}

/** Placeholder tertinggi (`$11` → 11). Nol bila tak ada. */
export function placeholderTertinggi(sql: string): number {
  const n = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  return n.length === 0 ? 0 : Math.max(...n);
}

/** Jumlah elemen tingkat-atas sebuah literal array, atau `null` bila dinamis. */
export function jumlahElemen(arr: string): number | null {
  const t = arr.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const isi = t.slice(1, -1).trim();
  if (isi === "") return 0;
  if (isi.includes("...")) return null; // spread — tak dapat dinilai
  const bagian = pisahArgumen(`(${isi})`, 0);
  return bagian === null ? null : bagian.map((x) => x.trim()).filter((x) => x !== "").length;
}

export type Vonis =
  | { jenis: "cocok"; butuh: number; diberi: number }
  | { jenis: "timpang"; butuh: number; diberi: number }
  | {
      jenis: "tak_dinilai";
      /**
       * ⛔ `tanpa_sql_literal` dan `tanpa_placeholder` SENGAJA TERPISAH: yang
       * pertama berarti "tak bisa dinilai" (SQL-nya variabel), yang kedua
       * berarti "tak perlu dinilai" (SQL literal tanpa `$` dan tanpa array).
       * Meleburnya membuat 122 kueri yang aman tak bisa dibedakan dari kueri
       * yang luput dari pemeriksaan — persis kelas yang penjaga ini tutup.
       */
      sebab: "sql_interpolasi" | "array_dinamis" | "tanpa_sql_literal" | "tanpa_placeholder";
    };

/**
 * Vonis satu pemanggilan. **Satu pembuat vonis**, dipakai penjaga atas repo
 * nyata maupun uji atas kode karangan.
 */
export function vonisAritas(argumen: readonly string[]): Vonis {
  // Argumen literal PERTAMA adalah SQL-nya — apa pun isinya. Versi pertama
  // menuntut kata kunci SQL, sehingga `"BEGIN"` dan `"COMMIT"` terbuang ke
  // "tak dapat dinilai" dan angka 89 itu melebih-lebihkan yang tak terjangkau.
  const sql = argumen.find((a) => /^[`'"]/.test(a));
  if (sql === undefined) return { jenis: "tak_dinilai", sebab: "tanpa_sql_literal" };
  const butuh = placeholderTertinggi(sql);
  const arrArg = argumen.find((a) => a.startsWith("["));
  if (butuh === 0 && arrArg === undefined) {
    return { jenis: "tak_dinilai", sebab: "tanpa_placeholder" };
  }
  if (sql.includes("${")) return { jenis: "tak_dinilai", sebab: "sql_interpolasi" };
  if (arrArg === undefined) return { jenis: "tak_dinilai", sebab: "array_dinamis" };
  const diberi = jumlahElemen(arrArg);
  if (diberi === null) return { jenis: "tak_dinilai", sebab: "array_dinamis" };
  return butuh === diberi ? { jenis: "cocok", butuh, diberi } : { jenis: "timpang", butuh, diberi };
}
