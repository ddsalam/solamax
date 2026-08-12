import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga PENEGAKAN di migrasi keuangan.
 *
 * ⚠️ Batas uji ini — sebut apa adanya: ia membaca **teks SQL**, jadi ia hanya
 * membuktikan bahwa migrasinya MENGATAKAN hal-hal ini. Bahwa Postgres benar-
 * benar MENEGAKKANNYA hanya bisa dibuktikan terhadap DB hidup, dan itu belum
 * dijalankan (kredensial `gcloud` perlu reauth). Jangan membaca hijaunya
 * sebagai "migrasi teruji".
 *
 * Kenapa tetap berharga: yang paling mungkin terjadi bukan Postgres berubah
 * perilaku, melainkan seseorang menghapus satu blok saat "merapikan" migrasi —
 * dan penghapusan itu **tidak berbunyi apa-apa** tanpa tes ini. Tabel unit-scoped
 * tanpa RLS, atau tabel append-only yang masih bisa di-UPDATE, terlihat persis
 * sama seperti yang benar sampai ada yang menyalahgunakannya.
 */

const MIG = (name: string) =>
  readFileSync(
    resolve(__dirname, "../../../backend/prisma/migrations", name, "migration.sql"),
    "utf8",
  );

const sql0020 = MIG("0020_purchase_price");
const sql0021 = MIG("0021_correction_reclass");

/**
 * Predikat RLS 0016, disalin persis. Kalau migrasi baru menyimpang darinya, dua
 * tabel akan punya dua definisi scope — dan yang menyimpang tak akan terlihat
 * sampai seseorang membandingkannya baris demi baris.
 */
const PREDIKAT_0016 = `unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))`;

describe("RLS unit-scoped ditulis ULANG di tiap migrasi baru", () => {
  // 0016 self-adjusting HANYA atas tabel yang sudah ada saat ia jalan;
  // `prisma migrate deploy` tidak menjalankannya ulang. Tabel unit-scoped yang
  // lahir sesudahnya WAJIB memasang RLS-nya sendiri.
  const kasus: [string, string, string[]][] = [
    ["0020", sql0020, ["purchase_price"]],
    ["0021", sql0021, ["reclassification", "correction_entry"]],
  ];

  for (const [nama, sql, tabel] of kasus) {
    it(`${nama}: ENABLE + FORCE + policy unit_scope`, () => {
      expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
      expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
      expect(sql).toMatch(/CREATE POLICY unit_scope/);
    });

    it(`${nama}: predikatnya IDENTIK dengan 0016 (fail-closed pada token non-numerik)`, () => {
      expect(sql).toContain(PREDIKAT_0016);
    });

    it(`${nama}: menyebut setiap tabel unit-scoped-nya`, () => {
      for (const t of tabel) expect(sql).toContain(t);
    });

    it(`${nama}: tiap tabel punya kolom unit_id`, () => {
      const jumlah = (sql.match(/"unit_id"\s+SMALLINT NOT NULL/g) ?? []).length;
      expect(jumlah).toBe(tabel.length);
    });
  }
});

describe("0021: append-only ditegakkan di lapis hak akses", () => {
  it("dashboard_app hanya SELECT + INSERT", () => {
    expect(sql0021).toContain('GRANT SELECT, INSERT ON "app"."reclassification" TO dashboard_app');
    expect(sql0021).toContain('GRANT SELECT, INSERT ON "app"."correction_entry" TO dashboard_app');
  });

  it("UPDATE dan DELETE di-REVOKE EKSPLISIT pada kedua tabel", () => {
    // Eksplisit karena deploy B1 memasang ALTER DEFAULT PRIVILEGES yang
    // memberi UPDATE/DELETE — tanpa REVOKE, jejaknya bisa disunting.
    expect(sql0021).toContain('REVOKE UPDATE, DELETE ON "app"."reclassification" FROM dashboard_app');
    expect(sql0021).toContain('REVOKE UPDATE, DELETE ON "app"."correction_entry" FROM dashboard_app');
  });

  it("tidak ada GRANT UPDATE/DELETE yang menyelinap", () => {
    // Hanya PERNYATAAN GRANT yang diperiksa — baris komentar sengaja dibuang,
    // sebab komentar di migrasi ini memang menyebut kata UPDATE/DELETE saat
    // menjelaskan kenapa REVOKE-nya perlu.
    const pernyataanGrant = sql0021
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("--"))
      .filter((l) => l.startsWith("GRANT"));

    expect(pernyataanGrant.length).toBeGreaterThan(0); // jangan hijau karena kosong
    for (const g of pernyataanGrant) {
      expect(g, g).not.toMatch(/\bUPDATE\b/);
      expect(g, g).not.toMatch(/\bDELETE\b/);
    }
  });
});

describe("0021: pemisahan tugas pengaju ≠ approver", () => {
  it("ditegakkan CHECK di DB, bukan hanya di aplikasi", () => {
    expect(sql0021).toMatch(
      /CHECK \(\s*"submitted_by_user_id" <> "approved_by_user_id"\s*\)/,
    );
  });

  it("ketujuh field audit §4.5 ada semua", () => {
    for (const kolom of [
      "original_txn_id",
      "reason_code",
      "value_before",
      "value_after",
      "submitted_by_user_id",
      "approved_by_user_id",
      "approved_at",
    ]) {
      expect(sql0021, kolom).toContain(`"${kolom}"`);
    }
  });

  it("kind terbatas pada reversal / corrected_entry", () => {
    expect(sql0021).toContain(`"kind" IN ('reversal', 'corrected_entry')`);
  });
});

describe("0020: penjaga harga beli", () => {
  it("harga wajib > 0 — menutup jalan nol masuk (cacat Solar Bakau)", () => {
    expect(sql0020).toMatch(/CHECK \("price" > 0\)/);
  });

  it("jejak P1 wajib LENGKAP bila P1 terpicu", () => {
    expect(sql0020).toContain('NOT "p1_triggered" OR (');
    expect(sql0020).toContain('"p1_acknowledged_by" IS NOT NULL');
    expect(sql0020).toContain(`btrim(COALESCE("p1_reason", '')) <> ''`);
  });

  it("jejak P1 TIDAK boleh ada bila P1 tak terpicu (hitungan frekuensi bersih)", () => {
    expect(sql0020).toContain('"p1_triggered" OR (');
    expect(sql0020).toContain('"p1_acknowledged_by" IS NULL');
  });

  it("VOID-only: tanpa DELETE untuk dashboard_app", () => {
    expect(sql0020).toContain('REVOKE DELETE ON "app"."purchase_price" FROM dashboard_app');
  });

  it("satu baris AKTIF per (unit, produk, berlaku-sejak)", () => {
    expect(sql0020).toMatch(/CREATE UNIQUE INDEX[^;]*purchase_price_active_uq[^;]*WHERE NOT void/s);
  });
});
