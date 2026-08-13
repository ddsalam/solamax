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

/**
 * Buang baris komentar sebelum memeriksa PERNYATAAN.
 *
 * Ditambahkan setelah uji mutasi menemukan cacat di tes ini sendiri: mematikan
 * trigger dengan mengomentarinya (`-- CREATE TRIGGER`) tetap lolos, sebab teks
 * mentahnya masih MENGANDUNG kalimat itu. Penjaga yang bisa dijinakkan dengan
 * dua tanda hubung bukan penjaga.
 */
const pernyataan = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

/**
 * Ambil SATU pernyataan utuh yang dimulai dengan `prefix` (komentar dibuang,
 * berhenti di `;` pertama di luar dollar-quote).
 *
 * Ditambahkan setelah uji mutasi menemukan cacat KEEMPAT dari kelas yang sama:
 * mengomentari BARIS `CREATE TRIGGER` saja tetap lolos, sebab asersi lainnya
 * (`BEFORE UPDATE OR DELETE`, `EXECUTE FUNCTION`) ada di baris-baris BERIKUTNYA
 * yang tidak ikut dikomentari — jadi semuanya tetap "ditemukan", hanya saja
 * tidak lagi menjadi satu pernyataan.
 *
 * Memeriksa fragmen yang tersebar tidak membuktikan pernyataannya utuh. Yang
 * membuktikan adalah menuntut semuanya berada di dalam SATU pernyataan.
 */
const pernyataanYangDimulai = (sql: string, prefix: string): string => {
  // Buang isi dollar-quote lebih dulu supaya `;` di dalam body fungsi tidak
  // dianggap akhir pernyataan.
  const tanpaBody = pernyataan(sql).replace(/\$([a-z]*)\$[\s\S]*?\$\1\$/g, "$$BODY$$");
  const mulai = tanpaBody.indexOf(prefix);
  if (mulai < 0) return "";
  const akhir = tanpaBody.indexOf(";", mulai);
  return tanpaBody.slice(mulai, akhir < 0 ? undefined : akhir + 1);
};

const sql0020 = MIG("0020_purchase_price");
const sql0021 = MIG("0021_correction_reclass");
const sql0022 = MIG("0022_reason_code");
const sql0023 = MIG("0023_category_account_map");
const sql0024 = MIG("0024_manual_entry_workflow");
const sql0025 = MIG("0025_source_kind_closed");
const sql0026 = MIG("0026_day_close");

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
      const stmt = pernyataan(sql);
      expect(stmt).toMatch(/ENABLE ROW LEVEL SECURITY/);
      expect(stmt).toMatch(/FORCE ROW LEVEL SECURITY/);
      // Bukan sekadar "teksnya ada": policy harus benar-benar DIEKSEKUSI.
      // Ditemukan lewat uji mutasi — mengomentari baris `EXECUTE format(` saja
      // tetap meninggalkan kalimat CREATE POLICY di berkas.
      expect(stmt).toMatch(/EXECUTE format\(\s*'CREATE POLICY unit_scope/);
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

describe("0022: reason_code — ketertutupan ditegakkan di HAK AKSES", () => {
  it("dashboard_app hanya SELECT; INSERT/UPDATE/DELETE di-REVOKE", () => {
    // Inilah yang membuat daftarnya benar-benar tertutup, bukan sekadar disebut
    // tertutup: aplikasi TIDAK BISA menambah kode betapapun inginnya.
    expect(sql0022).toContain('GRANT SELECT ON "app"."reason_code" TO dashboard_app');
    expect(sql0022).toContain('REVOKE INSERT, UPDATE, DELETE ON "app"."reason_code" FROM dashboard_app');
  });

  it("seed ikut di migrasi, bukan skrip terpisah yang bisa lupa dijalankan", () => {
    expect(sql0022).toMatch(/INSERT INTO "app"\."reason_code"/);
    expect(sql0022).toMatch(/ON CONFLICT \("code"\) DO NOTHING/);
  });

  it("tepat 19 kode: 10 closing · 6 adjustment · 3 reclass", () => {
    // Mem-parse BARIS SEED, bukan menghitung kemunculan kata: baris CHECK
    // `applies_to IN ('closing', …)` juga memuat kata-kata itu, dan pemindai
    // yang naif akan menghitungnya (kejadian nyata saat tes ini ditulis).
    const seed = [
      ...sql0022.matchAll(/^\s*\('([A-Z-]+)',\s*'[^']*',\s*'(\w+)',\s*(true|false)\)/gm),
    ].map((m) => ({ code: m[1]!, appliesTo: m[2]!, target: m[3] === "true" }));

    expect(seed).toHaveLength(19);
    const per = (a: string) => seed.filter((r) => r.appliesTo === a).length;
    expect(per("closing")).toBe(10);
    expect(per("adjustment")).toBe(6);
    expect(per("reclass")).toBe(3);
    expect(new Set(seed.map((r) => r.code)).size).toBe(19); // tanpa duplikat
  });

  it("tidak ada kode 'Lain-lain' untuk penutupan hari", () => {
    // §10.2: katup jujurnya CLS-INVESTIGATING, bukan tempat sampah.
    expect(sql0022.toLowerCase()).not.toMatch(/'cls-(other|lain|misc)/);
  });

  it("CLS-INVESTIGATING satu-satunya yang menuntut tanggal target", () => {
    const butuhTarget = [
      ...sql0022.matchAll(/^\s*\('([A-Z-]+)',\s*'[^']*',\s*'\w+',\s*true\)/gm),
    ].map((m) => m[1]);
    expect(butuhTarget).toEqual(["CLS-INVESTIGATING"]);
  });

  it("kewajiban CHECK yang belum bisa ditulis DISEBUT, bukan didiamkan", () => {
    // day_close di luar lingkup Tugas 2, jadi CHECK-nya belum bisa ada. Yang
    // tidak boleh adalah kewajiban itu hilang tanpa jejak.
    expect(sql0022).toMatch(/KEWAJIBAN YANG DIBAWA/);
    expect(sql0022).toMatch(/day_close/);
  });
});

describe("0023: category_account_map — seragam, dan NULL tidak boleh lenyap", () => {
  it("14 pemetaan, SELURUHNYA default (unit_id NULL)", () => {
    const rows = sql0023.match(/^\s*\(NULL, '/gm) ?? [];
    expect(rows).toHaveLength(14);
  });

  it("NOL baris ber-unit di seed", () => {
    const berUnit = sql0023.match(/^\s*\(\d+, '/gm) ?? [];
    expect(berUnit).toHaveLength(0);
  });

  it("Supir Tangki = 6-2100 (beban operasional), BUKAN freight-in ke HPP", () => {
    // Kalau ini pernah berubah jadi akun 5-*, 10 kasus emas T3 harus dihitung
    // ulang — sebab Gross Profit tidak lagi Revenue+TeraValue+COGS.
    expect(sql0023).toMatch(/'Supir Tangki',\s*'6-2100'/);
    expect(sql0023).not.toMatch(/'Supir Tangki',\s*'5-/);
  });

  it("baris ber-unit menuntut alasan — tak bisa masuk tanpa disengaja", () => {
    expect(sql0023).toMatch(
      /CHECK \(\s*"unit_id" IS NULL OR btrim\(COALESCE\("override_reason", ''\)\) <> ''/,
    );
  });

  it("policy RLS memuat cabang unit_id IS NULL — kalau tidak, 14 default LENYAP", () => {
    // Predikat 0016 (`unit_id = ANY(...)`) menghasilkan NULL untuk baris
    // ber-unit_id NULL ⇒ tak terlihat siapa pun, tanpa galat apa pun.
    const stmt = pernyataan(sql0023);
    expect(stmt).toContain("unit_id IS NULL OR unit_id = ANY (ARRAY(");
    expect(stmt).toMatch(/EXECUTE format\(\s*'CREATE POLICY unit_scope/);
  });

  it("penyimpangan dari 0016 DISENGAJA dan disebut, termasuk bahayanya", () => {
    expect(sql0023).toMatch(/SENGAJA BERBEDA DARI 0016/);
    expect(sql0023).toMatch(/DROP POLICY IF EXISTS/);
  });

  it("unik parsial memakai COALESCE(unit_id,-1) — NULL tak sama dgn NULL", () => {
    expect(sql0023).toMatch(/COALESCE\("unit_id", -1\)/);
  });
});

describe("0024: manual_entry aditif — tabel produksi 7 unit", () => {
  it("semua kolom baru ditambah secara aditif & idempoten", () => {
    for (const k of [
      "operational_category", "accounting_account", "status",
      "submitted_at", "reviewed_by_user_id", "reviewed_at", "returned_reason",
    ]) {
      expect(sql0024, k).toContain(`ADD COLUMN IF NOT EXISTS "${k}"`);
    }
  });

  it("status di-backfill 'submitted', BUKAN 'closed'", () => {
    // Immutabilitas tidak dipasang mundur ke hari yang tak pernah melewati
    // gerbangnya. Kalau ini 'closed', ribuan hari diklaim sudah disahkan.
    expect(sql0024).toMatch(/"status"[\s\S]{0,80}NOT NULL DEFAULT 'submitted'/);
    expect(sql0024).not.toMatch(/DEFAULT 'closed'/);
  });

  it("TIDAK ada backfill nilai untuk kategori/akun", () => {
    expect(sql0024).not.toMatch(/UPDATE "app"\."manual_entry"\s+SET/i);
  });

  it("TIDAK ada CHECK yang memaksa kategori wajib (mode transisi)", () => {
    expect(sql0024).not.toMatch(/"operational_category" IS NOT NULL/);
  });

  it("void setelah hari ditutup ditolak — lewat TRIGGER, bukan CHECK", () => {
    // CHECK hanya melihat baris akhir; aturannya tentang PERPINDAHAN.
    // Diperiksa atas PERNYATAAN, bukan teks mentah: trigger yang dikomentari
    // harus berbunyi merah (ditemukan lewat uji mutasi).
    const trig = pernyataanYangDimulai(sql0024, "CREATE TRIGGER");
    expect(trig).not.toBe("");
    expect(trig).toContain('BEFORE UPDATE ON "app"."manual_entry"');
    expect(trig).toContain("EXECUTE FUNCTION");
    const stmt = pernyataan(sql0024);
    expect(stmt).toMatch(/NEW\."void" AND NOT OLD\."void" AND OLD\."status" = 'closed'/);
    expect(stmt).toMatch(/RAISE EXCEPTION/);
  });

  it("batas trigger disebut: immutabilitas PENUH belum ditegakkan", () => {
    expect(sql0024).toMatch(/immutabilitas PENUH/i);
  });
});

describe("0025: source_kind daftar tertutup", () => {
  it("kedua tabel dibatasi ke 'manual_entry'", () => {
    const stmt = pernyataan(sql0025);
    expect(stmt).toMatch(/reclassification_source_kind[\s\S]*?IN \('manual_entry'\)/);
    expect(stmt).toMatch(/correction_entry_source_kind[\s\S]*?IN \('manual_entry'\)/);
  });

  it("kewajiban memperluas penjaga yatim DI PR YANG SAMA disebut", () => {
    expect(sql0025).toMatch(/PR YANG\s*\n?--\s*SAMA|PR YANG SAMA/);
  });
});

describe("0026: day_close — gerbang penutupan hari", () => {
  const stmt = pernyataan(sql0026);

  it("PK (unit_id, business_date) — satu penutupan per unit per tanggal", () => {
    expect(stmt).toMatch(/PRIMARY KEY \("unit_id", "business_date"\)/);
  });

  it("TIER adalah fungsi dari selisih — ketiga ambang ditegakkan DB", () => {
    // Tanpa CHECK ini, selisih Rp 5 juta bisa ditulis within_tolerance dan lolos
    // tanpa persetujuan siapa pun: tangga §3.2 runtuh dari dalam, tanpa galat.
    expect(stmt).toMatch(/abs\("difference_rp"\) <= 10000\s+AND "tier" = 'within_tolerance'/);
    expect(stmt).toMatch(/abs\("difference_rp"\) <= 100000\s+AND "tier" = 'exception_hof'/);
    expect(stmt).toMatch(/abs\("difference_rp"\) >  100000\s+AND "tier" = 'override_direksi'/);
  });

  it("ambangnya pada NILAI MUTLAK, bukan nilai bertanda", () => {
    const tierCheck = stmt.slice(stmt.indexOf("day_close_tier_matches_difference"));
    const potong = tierCheck.slice(0, tierCheck.indexOf("),"));
    expect(potong).not.toMatch(/"difference_rp" (<=|>)\s*-?\d/);
    expect((potong.match(/abs\("difference_rp"\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("reason_code WAJIB bila selisih bukan nol", () => {
    expect(stmt).toMatch(/"difference_rp" = 0 OR "reason_code" IS NOT NULL/);
  });

  it("tanggal target dibaca dari DATA — 'CLS-INVESTIGATING' TIDAK di-hardcode", () => {
    // Aturannya milik masternya (requires_target_date), bukan nama kodenya.
    // Kode kedua yang menuntut target cukup diberi flag, tanpa menyentuh migrasi.
    expect(stmt).toMatch(
      /NOT COALESCE\("reason_requires_target", false\) OR "target_date" IS NOT NULL/,
    );
    expect(stmt).not.toMatch(/CLS-INVESTIGATING/);
  });

  it("bayangan requires_target dikunci FK KOMPOSIT ke masternya", () => {
    // Inilah yang membuat CHECK di atas tak bisa dibohongi: aplikasi tidak bisa
    // menulis reason_requires_target=false untuk kode yang sebenarnya menuntut.
    expect(stmt).toMatch(
      /FOREIGN KEY \("reason_code", "reason_requires_target"\)\s*\n?\s*REFERENCES "app"\."reason_code"\("code", "requires_target_date"\)/,
    );
    expect(stmt).toMatch(/UNIQUE \("code", "requires_target_date"\)/);
  });

  it("celah FK MATCH SIMPLE ditutup: kode & bayangannya ada/tiada bersama", () => {
    expect(stmt).toMatch(
      /\("reason_code" IS NULL\) = \("reason_requires_target" IS NULL\)/,
    );
  });

  it("persetujuan wajib utk tier di luar toleransi, terlarang utk di dalamnya", () => {
    expect(stmt).toMatch(/"tier" = 'within_tolerance'\s*\n?\s*OR "status" = 'open'/);
    expect(stmt).toMatch(/"tier" <> 'within_tolerance'\s*\n?\s*OR \("approved_by_user_id" IS NULL/);
  });

  it("RLS: predikat IDENTIK 0016, TANPA cabang IS NULL — dan itu keputusan", () => {
    expect(stmt).toContain(PREDIKAT_0016);
    expect(stmt).not.toContain("unit_id IS NULL OR");
    expect(stmt).toMatch(/EXECUTE format\(\s*'CREATE POLICY unit_scope/);
    // Ketiadaan cabang NULL harus terbaca sebagai KEPUTUSAN, bukan kebetulan.
    expect(sql0026).toMatch(/CABANG NULL DIPUTUSKAN SECARA SADAR/);
  });

  it("immutabilitas manual_entry setelah tutup: trigger UPDATE **dan** DELETE", () => {
    const trig = pernyataanYangDimulai(sql0026, "CREATE TRIGGER");
    expect(trig).not.toBe("");
    expect(trig).toMatch(/BEFORE UPDATE OR DELETE ON "app"\."manual_entry"/);
    expect(trig).toContain("EXECUTE FUNCTION");
    expect(stmt).toMatch(/RAISE EXCEPTION/);
    // Bertanya pada FAKTA penutupan (day_close), bukan pada penanda yang
    // mewakilinya (manual_entry.status) — penanda harus diingat seseorang.
    expect(stmt).toMatch(/FROM "app"\."day_close" d/);
    expect(stmt).toMatch(/d\."status" = 'closed'/);
  });

  it("batas trigger DISEBUT: INSERT belum ditahan", () => {
    expect(sql0026).toMatch(/TIDAK menahan INSERT/);
  });

  it("urutan wajib saat menutup hari ditulis di migrasinya", () => {
    expect(sql0026).toMatch(/URUTAN YANG WAJIB DIIKUTI/);
  });

  it("DELETE dicabut dari dashboard_app", () => {
    expect(stmt).toContain('REVOKE DELETE ON "app"."day_close" FROM dashboard_app');
  });
});
