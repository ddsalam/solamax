import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { ImporBankAi, type BacaanMenunggu, type RekeningBankLain } from "@/components/keuangan/ImporBankAi";
import { ImporBankMatriks, type SelTampil } from "@/components/keuangan/ImporBankMatriks";
import { getKodeAlasanBalik } from "@/lib/antar-unit-queries";
import { unitDotted, unitLabel } from "@/lib/config";
import { qScoped } from "@/lib/db";
import { bandingkanSaldoAwal, daftarBulan, periodeAwal, selMatriks } from "@/lib/impor-bank-model";
import { getRekeningBca, getRekeningKoranUnit, getSaldoBukuAwal, POLA_NAMA_BCA } from "@/lib/impor-bank-queries";
import { teksKeSen } from "@/lib/pihak-lawan-model";
import type { ScopedUnitId } from "@/lib/scope";
import { canImporRekeningKoran, canTarikRekeningKoran, canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { geserBulan } from "@/lib/bulan";
import { todayWib } from "@/lib/periods";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/** U10 — rekening BANK aktif selain BCA (BCA tetap lewat matriks e-statement, R29). */
async function getRekeningBankLain(unit: ScopedUnitId): Promise<RekeningBankLain[]> {
  return qScoped<RekeningBankLain>(
    unit,
    `SELECT id::text AS id, nama
       FROM app.cash_account
      WHERE unit_id = $1 AND kind = 'bank' AND active AND NOT (nama ~* $2)
      ORDER BY nama`,
    [unit, POLA_NAMA_BCA],
  );
}

/** U10 — bacaan bank lain yang menunggu konfirmasi HoF, beserta barisnya. */
async function getBacaanMenunggu(unit: ScopedUnitId): Promise<BacaanMenunggu[]> {
  const rk = await qScoped<{
    id: string;
    accountId: string;
    namaRekening: string;
    periode: string;
    sumber: "ai" | "manual";
    saldoAwal: string;
    totalDb: string;
    totalCr: string;
    saldoAkhir: string;
  }>(
    unit,
    `SELECT r.id::text AS id, r.account_id::text AS "accountId", a.nama AS "namaRekening",
            to_char(r.periode, 'YYYY-MM') AS periode, r.sumber,
            r.saldo_awal::text AS "saldoAwal", r.total_db::text AS "totalDb",
            r.total_cr::text AS "totalCr", r.saldo_akhir::text AS "saldoAkhir"
       FROM app.rekening_koran r
       JOIN app.cash_account a ON a.id = r.account_id AND a.unit_id = r.unit_id
      WHERE r.unit_id = $1 AND r.status = 'menunggu'
      ORDER BY r.periode, a.nama`,
    [unit],
  );
  if (rk.length === 0) return [];
  const baris = await qScoped<{ rk: string; tanggal: string; keterangan: string; amount: string; saldo: string | null }>(
    unit,
    `SELECT m.rekening_koran_id::text AS rk, to_char(m.tanggal_bank, 'YYYY-MM-DD') AS tanggal, m.keterangan,
            m.amount::text AS amount, m.saldo_setelah::text AS saldo
       FROM app.mutasi_bank m
      WHERE m.unit_id = $1 AND m.rekening_koran_id = ANY($2::uuid[])
      ORDER BY m.tanggal_bank, m.urutan`,
    [unit, rk.map((r) => r.id)],
  );
  return rk.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    namaRekening: r.namaRekening,
    periode: r.periode,
    sumber: r.sumber,
    kontrol: {
      "saldo-awal": teksKeSen(r.saldoAwal),
      "total-debet": teksKeSen(r.totalDb),
      "total-kredit": teksKeSen(r.totalCr),
      "saldo-akhir": teksKeSen(r.saldoAkhir),
    },
    baris: baris
      .filter((b) => b.rk === r.id)
      .map((b) => ({ tanggal: b.tanggal, keterangan: b.keterangan, amountSen: teksKeSen(b.amount), saldoSen: b.saldo === null ? null : teksKeSen(b.saldo) })),
  }));
}

/**
 * Impor rekening koran BCA per unit (rencana 2026-10-29 U9; R17–R19, R22, R31).
 *
 *   · matriks rekening BCA aktif (baris) × bulan sejak cut-over (kolom); tiap
 *     sel "belum diunggah" / "diunggah (N baris, M terbuka)" / "ditarik", plus
 *     perbandingan saldo awal rekening koran vs saldo buku (R18);
 *   · unggah per rekening — bulannya dibaca dari kepala berkas, bukan dipilih;
 *     hasilnya tampil di panel (diterima / sudah ada / kaki tidak cocok /
 *     rekening salah atau periode aktif);
 *   · Tarik (HoF) per sel aktif, dengan kode alasan + catatan (R31).
 *
 * Sel yang sudah diunggah bertaut ke `impor-bank/[periode]?akun=` — layar
 * klasifikasi rekening × bulan (U11).
 *
 * Rekening bank LAIN (BRI, BNI, Mandiri, …) — rencana 2026-11-02 U10 (R29,
 * R30): pembaca AI atau input manual dengan empat angka kontrol; bacaan yang
 * lolos menunggu konfirmasi HoF sebelum ikut pencocokan.
 *
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca   → `canViewLaporanKeuangan`
 *   · unggah / baca AI / input manual → `canImporRekeningKoran`
 *   · tarik / konfirmasi / tolak bacaan → `canTarikRekeningKoran`
 */
export default async function ImporBankPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const bolehUnggah = canImporRekeningKoran(ctx);
  const bolehTarik = canTarikRekeningKoran(ctx);
  const [rekening, semua, kodeAlasan, rekeningLain, menunggu] = await Promise.all([
    getRekeningBca(unit.unit_id),
    getRekeningKoranUnit(unit.unit_id),
    bolehTarik ? getKodeAlasanBalik() : Promise.resolve([]),
    getRekeningBankLain(unit.unit_id),
    getBacaanMenunggu(unit.unit_id),
  ]);

  // Kolom: bulan cut-over terawal (atau rekening koran terawal — mis. berkas
  // pra-cut-over, AE8) s.d. bulan ini (WIB).
  const kini = todayWib().slice(0, 7);
  const awalCalon = [
    ...rekening.map((r) => r.cutOver?.slice(0, 7)).filter((x): x is string => !!x),
    ...semua.filter((s) => rekening.some((r) => r.id === s.accountId)).map((s) => s.periode),
  ].sort();
  const bulan = daftarBulan(awalCalon[0] && awalCalon[0] < kini ? awalCalon[0] : kini, kini);
  // U10 — bulan pilihan rekening bank lain: setidaknya dua bulan terakhir
  // (rekening koran bulan lalu biasanya dibaca awal bulan berikutnya).
  const duaBulanLalu = geserBulan(kini, -2);
  const bulanLain = daftarBulan(bulan[0]! < duaBulanLalu ? bulan[0]! : duaBulanLalu, kini);

  // Perbandingan saldo awal (R18) hanya untuk rekening koran AKTIF.
  const aktif = semua.filter((s) => s.status === "aktif");
  const perbandingan = new Map(
    await Promise.all(
      aktif.map(async (s) => {
        const buku = await getSaldoBukuAwal(unit.unit_id, s.accountId, periodeAwal(s.periode));
        // `cutOver` rekening sudah jatuh ke cut-over unit bila rekening belum punya
        // saldo pembuka sendiri — sama dengan kepala baris di bawah.
        const cutOverUnit = rekening.find((r) => r.id === s.accountId)?.cutOver ?? null;
        return [s.id, bandingkanSaldoAwal({ periode: s.periode, saldoAwalSen: s.saldoAwalSen, buku, cutOverUnit })] as const;
      }),
    ),
  );

  const sel: Record<string, Record<string, SelTampil>> = {};
  for (const r of rekening) {
    sel[r.id] = {};
    for (const b of bulan) {
      const s = selMatriks(semua.filter((x) => x.accountId === r.id && x.periode === b));
      sel[r.id]![b] = s.status === "diunggah" ? { ...s, saldoAwal: perbandingan.get(s.id) ?? null } : s;
    }
  }

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-impor-bank"
      />
      <h1 className="text-h3 t-brand">Impor rekening koran</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)}
      </div>
      <p className="fs16 t-tertiary mt2">
        Unggah e-statement PDF BCA per rekening per bulan; bulannya dibaca dari berkas. Berkas ditolak utuh bila total
        mutasi, jumlah mutasi, atau saldo akhir hasil baca tidak sama persis dengan kaki rekening koran. Mengunggah
        berkas yang sama dua kali tidak menggandakan apa pun. Mutasi bertanggal sebelum saldo pembuka rekening disimpan
        tetapi tidak pernah dibukukan. Impor tidak menulis buku kas; buka sel yang sudah diunggah untuk mencocokkan dan
        mengklasifikasi baris-barisnya.
      </p>

      <section className="card card-pad-lg mt6" aria-labelledby="matriks-impor">
        <h3 id="matriks-impor" className="text-h3">
          Rekening BCA × bulan
        </h3>
        {rekening.length === 0 ? (
          <div className="empty-inline mt4">
            Unit ini belum punya rekening BCA aktif bernomor — tambahkan atau lengkapi nomornya di{" "}
            <a href={`/keuangan/unit/${unit.code}/akun-kas`}>Kelola akun kas</a>.
          </div>
        ) : (
          <ImporBankMatriks
            code={unit.code}
            rekening={rekening.map((r) => ({ id: r.id, nama: r.nama, cutOver: r.cutOver, cutOverSendiri: r.cutOverSendiri }))}
            bulan={bulan}
            sel={sel}
            bolehUnggah={bolehUnggah}
            bolehTarik={bolehTarik}
            kodeAlasan={kodeAlasan}
          />
        )}
      </section>

      <section className="card card-pad-lg mt6" aria-labelledby="rekening-koran-lain">
        <h3 id="rekening-koran-lain" className="text-h3">
          Rekening bank lain — baca rekening koran
        </h3>
        <p className="fs16 t-tertiary mt2">
          Untuk rekening selain BCA: ketik empat angka kontrol dari cetakan (saldo awal, total debet, total kredit, saldo
          akhir), lalu unggah PDF atau foto rekening koran. AI hanya membaca; bacaan dipakai bila keempat angka cocok tepat,
          saldo berjalan per baris cocok, dan saldo awal sama dengan saldo akhir bulan lalu yang sudah dikonfirmasi (atau
          saldo buku bank untuk rekening koran pertama). Bila tidak cocok, tidak ada yang disimpan — ketik barisnya secara
          manual dengan pemeriksaan yang sama. Bacaan yang lolos baru ikut pencocokan setelah dikonfirmasi Head of
          Finance. Paling banyak 10 kali baca AI per rekening per bulan.
        </p>
        {rekeningLain.length === 0 && menunggu.length === 0 ? (
          <div className="empty-inline mt4">Unit ini belum punya rekening bank aktif selain BCA.</div>
        ) : (
          <ImporBankAi
            code={unit.code}
            rekening={rekeningLain}
            bulan={bulanLain}
            menunggu={menunggu}
            bolehUnggah={bolehUnggah}
            bolehKonfirmasi={bolehTarik}
            kodeAlasan={kodeAlasan}
          />
        )}
      </section>
    </>
  );
}
