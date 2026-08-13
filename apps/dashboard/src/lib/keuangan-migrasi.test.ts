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

/**
 * Ambil blok `CREATE OR REPLACE FUNCTION … $tag$ … $tag$;` LENGKAP dengan
 * badannya (komentar dibuang lebih dulu).
 *
 * Berbeda dari {@link pernyataanYangDimulai}, yang sengaja MEMBUANG isi
 * dollar-quote supaya `;` di dalam badan tidak dikira akhir pernyataan. Untuk
 * memeriksa isi badan fungsi kita justru membutuhkannya — tetapi tetap harus
 * berangkat dari baris `CREATE`-nya, supaya mengomentari baris itu membuat
 * seluruh pemeriksaan MERAH, bukan lolos lewat badan yang masih tertinggal.
 */
const blokFungsi = (sql: string): string => {
  const teks = pernyataan(sql);
  const mulai = teks.indexOf("CREATE OR REPLACE FUNCTION");
  if (mulai < 0) return "";
  const tag = teks.slice(mulai).match(/AS (\$[a-z]*\$)/)?.[1];
  if (!tag) return "";
  const akhir = teks.indexOf(`${tag};`, teks.indexOf(tag, mulai) + tag.length);
  return akhir < 0 ? teks.slice(mulai) : teks.slice(mulai, akhir + tag.length + 1);
};

const sql0020 = MIG("0020_purchase_price");
const sql0021 = MIG("0021_correction_reclass");
const sql0022 = MIG("0022_reason_code");
const sql0023 = MIG("0023_category_account_map");
const sql0024 = MIG("0024_manual_entry_workflow");
const sql0025 = MIG("0025_source_kind_closed");
const sql0026 = MIG("0026_day_close");
const sql0027 = MIG("0027_backdate_override");
const sql0028 = MIG("0028_so_macet");
const sql0029 = MIG("0029_cash_ledger");
const sql0030 = MIG("0030_edc_settlement");

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

describe("0027: jalur tembus backdate — bentuknya mengikat", () => {
  const stmt = pernyataan(sql0027);

  it("⛔ BUKAN flag GUC — override adalah DATA yang dikonsultasi trigger", () => {
    // GUC fail-OPEN: aplikasi yang salah menyetelnya membuka pintu TANPA JEJAK.
    // Trigger ini hanya boleh membaca tabel, tidak current_setting().
    const gate = blokFungsi(sql0027);
    expect(gate).not.toMatch(/current_setting/);
    expect(gate).toMatch(/FROM "app"\."backdate_override" o/);
  });

  it("gerbang BEFORE INSERT terpasang sebagai SATU pernyataan utuh", () => {
    const trig = pernyataanYangDimulai(sql0027, "CREATE TRIGGER");
    expect(trig).not.toBe("");
    expect(trig).toMatch(/BEFORE INSERT ON "app"\."manual_entry"/);
    expect(trig).toContain("EXECUTE FUNCTION");
  });

  it("menahan HANYA bila harinya tertutup — hari biasa lewat tanpa syarat", () => {
    const gate = blokFungsi(sql0027);
    expect(gate).toMatch(/d\."status" = 'closed'/);
    expect(gate).toMatch(/RETURN NEW; -- hari belum ditutup/);
  });

  it("hanya menerima override yang DISETUJUI dan BELUM terpakai", () => {
    const gate = blokFungsi(sql0027);
    expect(gate).toMatch(/o\."approved_at" IS NOT NULL/);
    expect(gate).toMatch(/o\."consumed_at" IS NULL/);
    expect(gate).toMatch(/NOT o\."void"/);
    expect(gate).toMatch(/RAISE EXCEPTION/);
  });

  it("🔴 SEKALI PAKAI: override DIKONSUMSI dan tertaut ke entri yang diizinkan", () => {
    // Syarat terpenting. Override yang menetap membuka hari itu SELAMANYA.
    const gate = blokFungsi(sql0027);
    expect(gate).toMatch(/UPDATE "app"\."backdate_override"/);
    expect(gate).toMatch(/"consumed_at" = CURRENT_TIMESTAMP/);
    expect(gate).toMatch(/"consumed_by_entry_id" = NEW\."id"/);
  });

  it("balapan dua INSERT dikunci FOR UPDATE", () => {
    // Tanpa kunci baris, dua INSERT bersamaan bisa memakai SATU izin.
    const gate = blokFungsi(sql0027);
    expect(gate).toMatch(/FOR UPDATE/);
  });

  it("paling banyak SATU override aktif per (unit, tanggal)", () => {
    expect(stmt).toMatch(
      /CREATE UNIQUE INDEX[^;]*backdate_override_aktif_uq[^;]*WHERE "consumed_at" IS NULL AND NOT "void"/s,
    );
  });

  it("reason code WAJIB dari grup adjustment — dikunci FK komposit + CHECK", () => {
    expect(stmt).toMatch(
      /FOREIGN KEY \("reason_code", "reason_applies_to"\)\s*\n?\s*REFERENCES "app"\."reason_code"\("code", "applies_to"\)/,
    );
    expect(stmt).toMatch(/"reason_applies_to" = 'adjustment'/);
    expect(stmt).toMatch(/UNIQUE \("code", "applies_to"\)/);
  });

  it("pemisahan tugas pengaju ≠ approver, di DB", () => {
    expect(stmt).toMatch(/"approved_by_user_id" <> "requested_by_user_id"/);
  });

  it("persetujuan & konsumsi masing-masing PASANGAN utuh", () => {
    expect(stmt).toMatch(/\("approved_by_user_id" IS NULL\) = \("approved_at" IS NULL\)/);
    expect(stmt).toMatch(/\("consumed_at" IS NULL\) = \("consumed_by_entry_id" IS NULL\)/);
  });

  it("alasan tertulis wajib berisi", () => {
    expect(stmt).toMatch(/btrim\("alasan"\) <> ''/);
  });

  it("RLS predikat IDENTIK 0016, tanpa cabang NULL, dan itu dinyatakan", () => {
    expect(stmt).toContain(PREDIKAT_0016);
    expect(stmt).not.toContain("unit_id IS NULL OR");
    expect(stmt).toMatch(/EXECUTE format\(\s*'CREATE POLICY unit_scope/);
    expect(sql0027).toMatch(/DIPUTUSKAN SADAR/);
  });

  it("batas yang TIDAK dijaga DB disebut apa adanya", () => {
    expect(sql0027).toMatch(/TIDAK bisa menegakkan bahwa approver memenuhi `canCloseException`/);
  });
});

describe("0028: penandaan SO macet — manual, tanpa ambang", () => {
  const stmt = pernyataan(sql0028);

  it("⛔ TIDAK ada ambang hari di skemanya — macet adalah PENANDAAN", () => {
    // Ambang yang memutuskan akan menghapus SO yang masih ditagih, lalu
    // menghidupkannya lagi begitu angkanya digeser — tanpa pemilik, tanpa tanggal.
    expect(stmt).not.toMatch(/stale_days|threshold|ambang|umur_hari/i);
  });

  it("TIDAK di-seed — menandai SO unit sungguhan itu keputusan Finance", () => {
    expect(stmt).not.toMatch(/INSERT INTO "app"\."so_macet"/);
  });

  it("alasan wajib + jejak siapa/kapan", () => {
    expect(stmt).toMatch(/btrim\("alasan"\) <> ''/);
    expect(stmt).toContain('"marked_by_user_id"');
    expect(stmt).toContain('"marked_at"');
  });

  it("cnoso wajib ter-normalisasi — tautan CNOSO case-insensitive", () => {
    // Penandaan yang salah huruf tak akan pernah cocok dengan SO-nya, dan
    // diamnya itu terlihat persis seperti "tidak ada SO macet".
    expect(stmt).toMatch(/"cnoso" = lower\(btrim\("cnoso"\)\)/);
  });

  it("VOID-only: satu penandaan aktif per (unit, SO, produk), tanpa DELETE", () => {
    expect(stmt).toMatch(/CREATE UNIQUE INDEX[^;]*so_macet_aktif_uq[^;]*WHERE NOT "void"/s);
    expect(stmt).toContain('REVOKE DELETE ON "app"."so_macet" FROM dashboard_app');
  });

  it("RLS predikat IDENTIK 0016, tanpa cabang NULL", () => {
    expect(stmt).toContain(PREDIKAT_0016);
    expect(stmt).not.toContain("unit_id IS NULL OR");
    expect(stmt).toMatch(/EXECUTE format\(\s*'CREATE POLICY unit_scope/);
  });
});

describe("0029: buku kas & bank", () => {
  const stmt = pernyataan(sql0029);

  it("akun adalah DATA, bukan enum — penutupan lewat active + closed_at", () => {
    // Enum memaksa migrasi tiap kali rekening berubah, dan migrasi yang dipaksa
    // biasanya berakhir sebagai nilai lama yang dipakai ulang untuk hal lain.
    expect(stmt).toMatch(/CREATE TABLE IF NOT EXISTS "app"\."cash_account"/);
    expect(stmt).toMatch(/"active"\s+BOOLEAN NOT NULL DEFAULT true/);
    expect(stmt).toMatch(/"closed_at"\s+DATE/);
    expect(stmt).toMatch(/CHECK \("active" = \("closed_at" IS NULL\)\)/);
  });

  it("tujuh akun kas Bakau di-seed, persis §1.3", () => {
    const seedAkun = pernyataanYangDimulai(sql0029, 'INSERT INTO "app"."cash_account"');
    expect(seedAkun).not.toBe("");
    const seed = [...seedAkun.matchAll(/^\s*\(2, '([^']+)',\s*'(\w+)'\)/gm)].map((x) => x[1]);
    expect(seed).toEqual([
      "Kas Besar",
      "EDC Penampungan",
      "Bank BCA - 5125036811",
      "Bank BCA - 5125978301",
      "Bank BRI",
      "Bank Mandiri",
      "Bank BNI",
    ]);
  });

  it("⚠️ empat bank dorman TIDAK ditandai nonaktif — §7.7 belum dijawab", () => {
    // Dorman ≠ ditutup. Menandainya `false` berarti menjawab pertanyaan yang
    // masih terbuka; yang boleh menjawab hanya tim keuangan.
    expect(stmt).not.toMatch(/\(2, 'Bank BRI',\s*'bank',\s*false\)/);
    expect(sql0029).toMatch(/Dorman ≠ ditutup/);
  });

  it("kategori mutasi = daftar TERTUTUP: 7 debet + 8 kredit, app hanya SELECT", () => {
    // Dihitung DI DALAM pernyataan INSERT-nya, bukan atas seluruh berkas:
    // mengomentari baris `INSERT INTO` saja meninggalkan baris VALUES-nya utuh,
    // dan pemindai yang naif akan tetap menghitungnya (ditemukan lewat mutasi).
    const seedKategori = pernyataanYangDimulai(
      sql0029,
      'INSERT INTO "app"."cash_mutation_category"',
    );
    expect(seedKategori).not.toBe("");
    const debet = (seedKategori.match(/^\s*\('debet',\s*'/gm) ?? []).length;
    const kredit = (seedKategori.match(/^\s*\('kredit',\s*'/gm) ?? []).length;
    expect(debet).toBe(7);
    expect(kredit).toBe(8);
    expect(stmt).toContain('GRANT SELECT ON "app"."cash_mutation_category" TO dashboard_app');
    expect(stmt).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON "app"."cash_mutation_category" FROM dashboard_app',
    );
  });

  it("⛔ TIDAK ada kolom saldo di ledger — saldo adalah turunan", () => {
    expect(stmt).not.toMatch(/"saldo[_a-z]*"\s+(DECIMAL|NUMERIC)/i);
  });

  it("🔴 kategori WAJIB sesisi dengan jenis mutasinya", () => {
    expect(stmt).toMatch(/"jenis" = 'debet'\s+AND "category_side" = 'debet'/);
    expect(stmt).toMatch(/"jenis" = 'kredit' AND "category_side" = 'kredit'/);
    expect(stmt).toMatch(/"jenis" = 'adjustment' AND "category_side" IS NULL/);
  });

  it("tanda nominal mengikuti jenis; mutasi nol ditolak", () => {
    expect(stmt).toMatch(/"jenis" = 'debet'\s+AND "amount" > 0/);
    expect(stmt).toMatch(/"jenis" = 'kredit' AND "amount" < 0/);
    expect(stmt).toMatch(/"jenis" = 'adjustment' AND "amount" <> 0/);
  });

  it("mutasi terkunci ke akun milik unit yang SAMA (FK komposit)", () => {
    // Tanpa ini, mutasi unit A bisa menunjuk akun unit B dan RLS pada ledger
    // TIDAK akan menangkapnya — unit_id barisnya sendiri sudah benar.
    expect(stmt).toMatch(
      /FOREIGN KEY \("account_id", "unit_id"\)\s*\n?\s*REFERENCES "app"\."cash_account"\("id", "unit_id"\)/,
    );
    expect(stmt).toMatch(/UNIQUE \("id", "unit_id"\)/);
  });

  it("kategori ledger terkunci ke master (FK komposit side+label)", () => {
    expect(stmt).toMatch(
      /FOREIGN KEY \("category_side", "category_label"\)\s*\n?\s*REFERENCES "app"\."cash_mutation_category"\("side", "label"\)/,
    );
  });

  it("VOID-only: tanpa DELETE untuk akun maupun ledger", () => {
    expect(stmt).toContain('REVOKE DELETE ON "app"."cash_account" FROM dashboard_app');
    expect(stmt).toContain('REVOKE DELETE ON "app"."cash_ledger"  FROM dashboard_app');
  });

  it("RLS pada cash_account & cash_ledger; predikat IDENTIK 0016, tanpa cabang NULL", () => {
    expect(stmt).toContain(PREDIKAT_0016);
    expect(stmt).not.toContain("unit_id IS NULL OR");
    // KETIGA pernyataan harus benar-benar DIEKSEKUSI. Ditemukan lewat mutasi:
    // mengomentari baris `EXECUTE format(` yang PERTAMA saja mematikan
    // ENABLE ROW LEVEL SECURITY, sementara asersi CREATE POLICY tetap hijau —
    // policy terpasang pada tabel yang RLS-nya tidak menyala sama sekali.
    expect(stmt).toMatch(/EXECUTE format\(\s*'ALTER TABLE "app"\.%I ENABLE ROW LEVEL SECURITY/);
    expect(stmt).toMatch(/EXECUTE format\(\s*'ALTER TABLE "app"\.%I FORCE ROW LEVEL SECURITY/);
    expect(stmt).toMatch(/EXECUTE format\(\s*'CREATE POLICY unit_scope/);
    expect(stmt).toMatch(/ARRAY\['cash_account', 'cash_ledger'\]/);
    expect(sql0029).toMatch(/DIPUTUSKAN SADAR/);
  });

  it("master kategori sengaja TANPA unit_id ⇒ tanpa RLS, dan itu dinyatakan", () => {
    expect(sql0029).toMatch(/TIDAK ber-`unit_id` ⇒ TIDAK ber-RLS, juga disengaja/);
  });
});

describe("0030: settlement EDC", () => {
  const stmt = pernyataan(sql0030);

  it("🔴 MDR adalah kolom GENERATED — tidak pernah diketik", () => {
    // Angka yang sudah diketahui sistem tak boleh punya kesempatan salah ketik.
    expect(stmt).toMatch(
      /"mdr_rp"\s+DECIMAL\(17,2\) GENERATED ALWAYS AS \("gross_rp" - "net_rp"\) STORED/,
    );
  });

  it("selisih transaksi vs batch juga GENERATED, dan bisa ber-reason_code", () => {
    expect(stmt).toMatch(/"selisih_rp"\s+DECIMAL\(17,2\) GENERATED ALWAYS AS/);
    expect(stmt).toMatch(/"reason_applies_to" IS NULL OR "reason_applies_to" = 'closing'/);
    expect(stmt).toMatch(
      /FOREIGN KEY \("reason_code", "reason_applies_to"\)\s*\n?\s*REFERENCES "app"\."reason_code"\("code", "applies_to"\)/,
    );
  });

  it("neto tak boleh melebihi bruto (MDR ≥ 0) dan bruto nol bukan batch", () => {
    expect(stmt).toMatch(/CHECK \("gross_rp" > 0\)/);
    expect(stmt).toMatch(/"net_rp" > 0 AND "net_rp" <= "gross_rp"/);
  });

  it("H+1: uang tak mungkin masuk sebelum hari penjualannya", () => {
    expect(stmt).toMatch(/CHECK \("settlement_date" >= "business_date"\)/);
  });

  it("akun tujuan terkunci ke unit yang SAMA (FK komposit)", () => {
    expect(stmt).toMatch(
      /FOREIGN KEY \("to_account_id", "unit_id"\)\s*\n?\s*REFERENCES "app"\."cash_account"\("id", "unit_id"\)/,
    );
  });

  it("satu batch per (unit, acquirer, nomor settlement)", () => {
    expect(stmt).toMatch(/CREATE UNIQUE INDEX[^;]*edc_settlement_no_uq[^;]*WHERE NOT "void"/s);
  });

  it("persetujuan posting = PASANGAN (siapa, kapan) — bukan penanda otomatis", () => {
    expect(stmt).toMatch(/\("posted_by_user_id" IS NULL\) = \("posted_at" IS NULL\)/);
  });

  it("baris buku kas bisa ditelusuri balik ke settlement-nya", () => {
    expect(stmt).toMatch(/ADD COLUMN IF NOT EXISTS "edc_settlement_id" UUID/);
    expect(stmt).toMatch(/cash_ledger_settlement_fk/);
  });

  it("RLS: ENABLE + FORCE + POLICY dieksekusi; predikat IDENTIK 0016 tanpa cabang NULL", () => {
    expect(stmt).toContain(PREDIKAT_0016);
    expect(stmt).not.toContain("unit_id IS NULL OR");
    expect(stmt).toMatch(/EXECUTE 'ALTER TABLE "app"\."edc_settlement" ENABLE ROW LEVEL SECURITY'/);
    expect(stmt).toMatch(/EXECUTE 'ALTER TABLE "app"\."edc_settlement" FORCE ROW LEVEL SECURITY'/);
    expect(stmt).toMatch(/EXECUTE format\(\s*'CREATE POLICY unit_scope/);
    expect(sql0030).toMatch(/DIPUTUSKAN SADAR/);
  });

  it("batas kaki ketiga (Beban MDR bukan akun kas) DISEBUT, bukan didiamkan", () => {
    expect(sql0030).toMatch(/Beban MDR bukan akun kas/);
    expect(sql0030).toMatch(/milik PENGAWAS|milik\s*\n?--\s*PENGAWAS/);
  });
});
