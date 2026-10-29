import { normalisasiNomorRekening } from "./impor-bank-model";
import { normalisasiSo } from "./penebusan-model";
import { addDays } from "./periods";
import { rpSen } from "./pihak-lawan-model";

/**
 * MESIN COCOK — bagian MURNI (rencana 2026-10-29 U10; R19, R20, R29; AE4,
 * AE10, AE11; KTD6, KTD7). Satu pembuat vonis (pola `adminStatus` /
 * `periksaTutupHari`): server action, kueri halaman, dan uji memakai fungsi
 * yang sama. Tanpa I/O.
 *
 * ⛔ KTD6 — pencocokan adalah TAUTAN. Fungsi di sini hanya MENUNJUK baris kas
 * yang sudah ada; tak ada yang menghasilkan baris kas baru, tanggal baru, atau
 * nominal baru.
 *
 * ⛔ KTD7 — kunci per jenis mutasi; OTOMATIS HANYA bila tepat satu kandidat:
 *
 *   · Debit ber-SO (B2B Pertamina): HANYA penebusan ber-SO sama (ternormalisasi
 *     `lower(trim())`), lalu baris kasnya. Nominal adalah PEMERIKSAAN sesudah
 *     kunci cocok — beda ⇒ cacat ditandai, tidak dicocokkan. Tak pernah lewat
 *     nominal saja; kas penebusan juga tak pernah jadi kandidat aturan lain.
 *   · Debit ber-nomor dokumen (KURANG BAYAR): HANYA baris kas yang keterangannya
 *     memuat nomor itu, nominal sama. (dok, nominal) kembar = dua baris; tak
 *     pernah diciutkan.
 *   · Kredit SETORAN JEMPUTAN: rekening sama, nominal sama, kategori "Setoran
 *     Hasil Penjualan", hari buku ∈ [tanggal bank − 3, tanggal bank].
 *   · Kredit EDC ("MID :"): kaki bank pencairan EDC (`edc_settlement_id`),
 *     net = kredit, tanggal settlement ∈ [tanggal bank − 3, tanggal bank].
 *   · Pindah buku sendiri: keterangan memuat nomor rekening yang TERDAFTAR di
 *     unit ini (bukan nama pemegang — "SOLA PETRA ABADI PT" memegang rekening
 *     beberapa unit). Kandidatnya kaki "Pindah Buku" di rekening baris ini
 *     yang kaki pasangannya (−nominal, tanggal sama) tercatat di rekening
 *     seberang itu.
 *   · Ketikan manual & kaki antar unit (semua mutasi tanpa SO/dok): rekening,
 *     tanda, nominal sama, tanggal asal (`tanggal_asal ?? business_date`) =
 *     tanggal bank.
 *
 * Kandidat kas hanya baris yang non-void, bukan saldo awal, belum di kelompok
 * aktif, dan TIDAK lahir dari kelompok lain (`lahir_dari_cocok_id`; baris yang
 * lahir dari kelompok yang sudah dibatalkan sudah di-void atau dibalik maju).
 * Baris impor pra-cut-over atau milik rekening koran ditarik tak pernah
 * dicocokkan (R22).
 */

export const KATEGORI_SETORAN = "Setoran Hasil Penjualan";
export const KATEGORI_PINDAH_BUKU = "Pindah Buku";
/** Jendela setoran & EDC: tanggal bank − tanggal buku ∈ [0, +3] hari (KTD7). */
export const JENDELA_HARI = 3;

export interface MutasiCocok {
  id: string;
  accountId: string;
  tanggalBank: string;
  keterangan: string;
  /** BERTANDA: CR +, DB −. */
  amountSen: number;
  so: string | null;
  dokRef: string | null;
  praCutover: boolean;
  rkStatus: "aktif" | "ditarik";
}

export interface KasCocok {
  id: string;
  accountId: string;
  businessDate: string;
  tanggalAsal: string | null;
  amountSen: number;
  keterangan: string;
  categoryLabel: string | null;
  void: boolean;
  saldoAwal: boolean;
  edcSettlementId: string | null;
  /** `edc_settlement.settlement_date` bila baris ini kaki pencairan EDC. */
  edcSettlementDate: string | null;
  pasanganUuid: string | null;
  /** Kelompok cocok yang melahirkan baris ini lewat klasifikasi (U11), bila ada. */
  lahirDariCocokId: string | null;
}

/** Penebusan AKTIF unit ini (no_so sudah ternormalisasi di DB, 0050). */
export interface PenebusanCocok {
  id: string;
  noSo: string;
  cashLedgerId: string;
}

export interface RekeningUnit {
  id: string;
  nomorRekening: string | null;
}

export interface KonteksCocok {
  kas: readonly KasCocok[];
  penebusan: readonly PenebusanCocok[];
  /** Rekening yang TERDAFTAR di unit ini (KTD13) — penentu pindah buku sendiri. */
  rekening: readonly RekeningUnit[];
  /** Baris kas yang sudah di kelompok cocok AKTIF. */
  kasDicocokkan: ReadonlySet<string>;
  /** Baris impor yang sudah di kelompok cocok AKTIF. */
  mutasiDicocokkan: ReadonlySet<string>;
}

export type AturanCocok =
  | "penebusan-so"
  | "dok-ref"
  | "setoran-jemputan"
  | "edc"
  | "pindah-buku-sendiri"
  | "antar-unit"
  | "ketikan";

export type TandaCocok =
  | "pra-cutover"
  | "ditarik"
  | "sudah-dicocokkan"
  /** Debit ber-SO tanpa penebusan aktif ber-SO itu — ketik penebusannya dulu. */
  | "penebusan-belum-diketik"
  /** Kunci SO cocok, nominal tidak — cacat, bukan cocok. */
  | "penebusan-nominal-beda"
  | "penebusan-rekening-beda"
  | "penebusan-kas-sudah-dicocokkan"
  /** Pindah buku ke rekening sendiri, tetapi kaki Pindah Buku-nya belum dicatat. */
  | "kaki-pasangan-belum-dicatat"
  /** Satu baris kas adalah satu-satunya kandidat bagi ≥ 2 baris impor. */
  | "diperebutkan";

export const LABEL_TANDA: Record<TandaCocok, string> = {
  "pra-cutover": "sebelum cut-over — tidak dibukukan",
  ditarik: "rekening koran ditarik",
  "sudah-dicocokkan": "sudah dicocokkan",
  "penebusan-belum-diketik": "penebusan belum diketik",
  "penebusan-nominal-beda": "nominal penebusan beda dengan debit bank",
  "penebusan-rekening-beda": "penebusan dibayar dari rekening lain",
  "penebusan-kas-sudah-dicocokkan": "baris kas penebusan sudah dicocokkan ke mutasi lain",
  "kaki-pasangan-belum-dicatat": "pindah buku sendiri — kaki Pindah Buku belum dicatat",
  diperebutkan: "satu baris buku jadi kandidat beberapa mutasi",
};

export interface Kandidat {
  cashLedgerId: string;
  aturan: AturanCocok;
}

export interface UsulanCocok {
  mutasiId: string;
  jenis: "tunggal" | "banyak" | "tanpa";
  kandidat: Kandidat[];
  tanda: TandaCocok | null;
  /** Baris yang DITUNJUK cacat (bukan kandidat) — mis. penebusan bernominal beda. */
  rujukan?: { cashLedgerId?: string; penebusanId?: string };
}

const tanggalAsal = (k: KasCocok): string => k.tanggalAsal ?? k.businessDate;
const dalamJendela = (tanggalBuku: string, tanggalBank: string): boolean =>
  tanggalBuku <= tanggalBank && tanggalBuku >= addDays(tanggalBank, -JENDELA_HARI);

function hasil(m: MutasiCocok, kandidat: Kandidat[], tandaKosong: TandaCocok | null = null): UsulanCocok {
  const unik = kandidat.filter((k, i) => kandidat.findIndex((x) => x.cashLedgerId === k.cashLedgerId) === i);
  return {
    mutasiId: m.id,
    jenis: unik.length === 1 ? "tunggal" : unik.length > 1 ? "banyak" : "tanpa",
    kandidat: unik,
    tanda: unik.length === 0 ? tandaKosong : null,
  };
}

const tanpa = (m: MutasiCocok, tanda: TandaCocok, rujukan?: UsulanCocok["rujukan"]): UsulanCocok => ({
  mutasiId: m.id,
  jenis: "tanpa",
  kandidat: [],
  tanda,
  ...(rujukan ? { rujukan } : {}),
});

/** Nomor rekening unit ini (selain rekening baris itu) yang tercetak di keterangan. */
function rekeningSeberang(m: MutasiCocok, rekening: readonly RekeningUnit[]): string | null {
  const angka = new Set((m.keterangan.match(/\d{6,}/g) ?? []).map(normalisasiNomorRekening).filter((x) => x !== ""));
  const r = rekening.find(
    (x) => x.id !== m.accountId && x.nomorRekening !== null && angka.has(normalisasiNomorRekening(x.nomorRekening)),
  );
  return r?.id ?? null;
}

export function usulkanCocok(m: MutasiCocok, ktx: KonteksCocok): UsulanCocok {
  if (m.rkStatus !== "aktif") return tanpa(m, "ditarik");
  if (m.praCutover) return tanpa(m, "pra-cutover");
  if (ktx.mutasiDicocokkan.has(m.id)) return tanpa(m, "sudah-dicocokkan");

  const milikPenebusan = new Map(ktx.penebusan.map((p) => [p.cashLedgerId, p]));
  const bebas = (k: KasCocok): boolean =>
    !k.void && !k.saldoAwal && k.lahirDariCocokId === null && !ktx.kasDicocokkan.has(k.id);
  /** Baris berkunci (penebusan, kaki EDC) hanya lewat aturan kuncinya sendiri. */
  const bebasTakBerkunci = (k: KasCocok): boolean => bebas(k) && !milikPenebusan.has(k.id) && k.edcSettlementId === null;

  // 1. Debit ber-SO — HANYA penebusan.
  if (m.so !== null && m.amountSen < 0) {
    const p = ktx.penebusan.find((x) => x.noSo === normalisasiSo(m.so!));
    const k = p ? ktx.kas.find((x) => x.id === p.cashLedgerId) : undefined;
    if (!p || !k || k.void) return tanpa(m, "penebusan-belum-diketik");
    const rujukan = { cashLedgerId: k.id, penebusanId: p.id };
    if (ktx.kasDicocokkan.has(k.id)) return tanpa(m, "penebusan-kas-sudah-dicocokkan", rujukan);
    if (k.accountId !== m.accountId) return tanpa(m, "penebusan-rekening-beda", rujukan);
    if (k.amountSen !== m.amountSen) return tanpa(m, "penebusan-nominal-beda", rujukan);
    return hasil(m, [{ cashLedgerId: k.id, aturan: "penebusan-so" }]);
  }

  // 2. Debit ber-nomor dokumen — HANYA keterangan yang memuat nomornya.
  if (m.dokRef !== null && m.amountSen < 0) {
    const dok = m.dokRef.trim().toUpperCase();
    return hasil(
      m,
      ktx.kas
        .filter(
          (k) =>
            bebasTakBerkunci(k) &&
            k.accountId === m.accountId &&
            k.amountSen === m.amountSen &&
            dok !== "" &&
            k.keterangan.toUpperCase().includes(dok),
        )
        .map((k) => ({ cashLedgerId: k.id, aturan: "dok-ref" as const })),
    );
  }

  const ket = m.keterangan.toUpperCase();
  const kandidat: Kandidat[] = [];
  let tandaKosong: TandaCocok | null = null;

  // 3. Setoran jemputan.
  if (m.amountSen > 0 && ket.includes("SETORAN JEMPUTAN")) {
    for (const k of ktx.kas) {
      if (
        bebasTakBerkunci(k) &&
        k.accountId === m.accountId &&
        k.categoryLabel === KATEGORI_SETORAN &&
        k.amountSen === m.amountSen &&
        dalamJendela(k.businessDate, m.tanggalBank)
      ) {
        kandidat.push({ cashLedgerId: k.id, aturan: "setoran-jemputan" });
      }
    }
  }

  // 4. Kredit EDC.
  if (m.amountSen > 0 && /\bMID\s*:/.test(ket)) {
    for (const k of ktx.kas) {
      if (
        bebas(k) &&
        !milikPenebusan.has(k.id) &&
        k.edcSettlementId !== null &&
        k.edcSettlementDate !== null &&
        k.accountId === m.accountId &&
        k.amountSen === m.amountSen &&
        dalamJendela(k.edcSettlementDate, m.tanggalBank)
      ) {
        kandidat.push({ cashLedgerId: k.id, aturan: "edc" });
      }
    }
  }

  // 5. Pindah buku antar rekening SENDIRI.
  const seberang = rekeningSeberang(m, ktx.rekening);
  if (seberang !== null) {
    for (const k of ktx.kas) {
      if (
        bebasTakBerkunci(k) &&
        k.accountId === m.accountId &&
        k.categoryLabel === KATEGORI_PINDAH_BUKU &&
        k.amountSen === m.amountSen &&
        tanggalAsal(k) === m.tanggalBank &&
        ktx.kas.some(
          (x) =>
            !x.void &&
            x.accountId === seberang &&
            x.categoryLabel === KATEGORI_PINDAH_BUKU &&
            x.amountSen === -m.amountSen &&
            tanggalAsal(x) === m.tanggalBank,
        )
      ) {
        kandidat.push({ cashLedgerId: k.id, aturan: "pindah-buku-sendiri" });
      }
    }
    tandaKosong = "kaki-pasangan-belum-dicatat";
  }

  // 6. Ketikan manual & kaki antar unit.
  for (const k of ktx.kas) {
    if (bebasTakBerkunci(k) && k.accountId === m.accountId && k.amountSen === m.amountSen && tanggalAsal(k) === m.tanggalBank) {
      kandidat.push({ cashLedgerId: k.id, aturan: k.pasanganUuid !== null ? "antar-unit" : "ketikan" });
    }
  }

  return hasil(m, kandidat, tandaKosong);
}

/**
 * Usulan untuk sekumpulan baris impor terhadap SATU potret buku. Baris kas yang
 * menjadi satu-satunya kandidat bagi dua baris impor atau lebih TIDAK pernah
 * dicocokkan otomatis ke salah satunya (tak ada yang tahu yang mana) — semua
 * baris itu turun menjadi "banyak", ditandai "diperebutkan".
 */
export function usulkanSemua(ms: readonly MutasiCocok[], ktx: KonteksCocok): UsulanCocok[] {
  const usulan = ms.map((m) => usulkanCocok(m, ktx));
  const tunggal = new Map<string, number>();
  for (const u of usulan) {
    if (u.jenis === "tunggal") tunggal.set(u.kandidat[0]!.cashLedgerId, (tunggal.get(u.kandidat[0]!.cashLedgerId) ?? 0) + 1);
  }
  return usulan.map((u) =>
    u.jenis === "tunggal" && (tunggal.get(u.kandidat[0]!.cashLedgerId) ?? 0) > 1 ? { ...u, jenis: "banyak", tanda: "diperebutkan" } : u,
  );
}

// ---------------------------------------------------------------------------
// Kelompok manual N:M (KTD6)
// ---------------------------------------------------------------------------

export type HasilPeriksaKelompok = { ok: true; totalSen: number } | { ok: false; error: string };

/**
 * Kelompok pilihan Keuangan: N baris impor ↔ M baris kas. Σ baris bank = Σ
 * baris buku **per rekening**, tepat Rp 0 dalam sen bulat (KTD6) — per
 * rekening, karena saldo buku tiap rekening harus sama dengan banknya; total
 * yang sama dengan rekening yang tertukar tetap salah. Baris kas hanya boleh di
 * rekening yang punya baris bank di kelompok itu. Baris kas penebusan hanya
 * boleh berkelompok dengan debit ber-SO yang SAMA (tak ada cocok silang, AE10).
 */
export function periksaKelompokManual(
  g: { mutasi: readonly MutasiCocok[]; kas: readonly KasCocok[] },
  ktx: Pick<KonteksCocok, "penebusan" | "kasDicocokkan" | "mutasiDicocokkan">,
): HasilPeriksaKelompok {
  if (g.mutasi.length === 0) return { ok: false, error: "Pilih minimal satu baris rekening koran." };
  const idM = new Set(g.mutasi.map((m) => m.id));
  const idK = new Set(g.kas.map((k) => k.id));
  if (idM.size !== g.mutasi.length || idK.size !== g.kas.length) {
    return { ok: false, error: "Ada baris yang dipilih dua kali — muat ulang halaman." };
  }
  for (const m of g.mutasi) {
    if (m.rkStatus !== "aktif") return { ok: false, error: "Ada baris dari rekening koran yang sudah ditarik." };
    if (m.praCutover) return { ok: false, error: "Ada baris bertanggal sebelum cut-over — baris itu tidak dibukukan dan tak bisa dicocokkan." };
    if (ktx.mutasiDicocokkan.has(m.id)) return { ok: false, error: "Ada baris rekening koran yang sudah dicocokkan — muat ulang halaman." };
  }
  const akunBank = new Set(g.mutasi.map((m) => m.accountId));
  for (const k of g.kas) {
    if (k.void) return { ok: false, error: "Ada baris buku yang sudah dibatalkan." };
    if (k.saldoAwal) return { ok: false, error: "Saldo awal rekening tidak bisa dicocokkan ke mutasi bank." };
    if (k.lahirDariCocokId !== null) return { ok: false, error: "Ada baris buku milik kelompok cocok lain — muat ulang halaman." };
    if (ktx.kasDicocokkan.has(k.id)) return { ok: false, error: "Ada baris buku yang sudah dicocokkan — muat ulang halaman." };
    if (!akunBank.has(k.accountId)) {
      return { ok: false, error: "Ada baris buku di rekening yang tak punya baris bank di kelompok ini — pilih baris buku rekening yang sama." };
    }
  }
  const milikPenebusan = new Map(ktx.penebusan.map((p) => [p.cashLedgerId, p]));
  for (const k of g.kas) {
    const p = milikPenebusan.get(k.id);
    if (!p) continue;
    const silang = g.mutasi.find((m) => m.so !== null && normalisasiSo(m.so) !== p.noSo);
    if (silang) {
      return { ok: false, error: `Debit ber-SO ${silang.so} tidak bisa dicocokkan ke penebusan SO ${p.noSo} — cocokkan ke penebusan ber-SO sama.` };
    }
  }
  for (const akun of akunBank) {
    const bank = g.mutasi.filter((m) => m.accountId === akun).reduce((t, m) => t + m.amountSen, 0);
    const buku = g.kas.filter((k) => k.accountId === akun).reduce((t, k) => t + k.amountSen, 0);
    if (bank !== buku) {
      return {
        ok: false,
        error:
          `Kelompok tidak seimbang: Σ baris bank ${bank < 0 ? "−" : ""}${rpSen(bank)} ≠ Σ baris buku ` +
          `${buku < 0 ? "−" : ""}${rpSen(buku)}, selisih ${rpSen(bank - buku)}. Kelompok cocok harus tepat Rp 0.`,
      };
    }
  }
  return { ok: true, totalSen: g.mutasi.reduce((t, m) => t + m.amountSen, 0) };
}
