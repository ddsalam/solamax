/**
 * 🔒 ATURAN KESELAMATAN TAK BISA DINEGOSIASI (CLAUDE.md #1).
 * Pertahanan berlapis: koneksi MySQL EasyMax HARUS read-only. Lapisan utama =
 * user MySQL ber-privilege SELECT saja. Lapisan ini = guard di level kode:
 * SETIAP query yang dikirim agent ke easymax WAJIB lolos assertSelectOnly().
 *
 * Tidak ada jalur lain ke driver MySQL selain lewat fungsi yang memanggil ini
 * (lihat db/mysql.ts). Tujuannya: walau ada bug/typo, kode tak akan pernah
 * mengeksekusi INSERT/UPDATE/DELETE/DDL ke DB POS yang sedang dipakai pompa.
 */

const FORBIDDEN = [
  "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "TRUNCATE",
  "DROP", "ALTER", "CREATE", "RENAME", "GRANT", "REVOKE",
  "LOCK", "UNLOCK", "CALL", "DO", "HANDLER", "LOAD", "SET",
  "START", "COMMIT", "ROLLBACK", "SAVEPOINT", "PREPARE", "EXECUTE",
] as const;

/** Buang komentar SQL (-- baris, /* blok *\/) dan whitespace tepi. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .trim();
}

export class ReadOnlyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyViolationError";
  }
}

/**
 * Lempar ReadOnlyViolationError bila `sql` bukan SELECT tunggal murni.
 * Mengizinkan hanya statement diawali SELECT (atau SHOW/DESCRIBE/EXPLAIN untuk
 * introspeksi read-only), tanpa multiple-statement.
 */
export function assertSelectOnly(sql: string): void {
  const cleaned = stripComments(sql);
  if (cleaned.length === 0) {
    throw new ReadOnlyViolationError("query kosong");
  }

  // Tolak multiple statements (cegah penyelipan write setelah ';').
  // Titik koma trailing tunggal diperbolehkan.
  const withoutTrailing = cleaned.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new ReadOnlyViolationError("multiple statement tidak diizinkan");
  }

  const firstWord = withoutTrailing.split(/[\s(]/, 1)[0]!.toUpperCase();
  const allowedStart = ["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"];
  if (!allowedStart.includes(firstWord)) {
    throw new ReadOnlyViolationError(
      `hanya SELECT/SHOW/DESCRIBE diizinkan, ditemukan: ${firstWord}`,
    );
  }

  // Sapu keyword tulis sebagai token utuh (hindari false-positive seperti
  // kolom 'CREATED_AT' atau 'UPDATED' — dicocokkan dengan batas kata).
  const upper = withoutTrailing.toUpperCase();
  for (const kw of FORBIDDEN) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upper)) {
      throw new ReadOnlyViolationError(`keyword tulis terdeteksi: ${kw}`);
    }
  }
}
