import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { ImporBankMatriks, type SelTampil } from "@/components/keuangan/ImporBankMatriks";
import { getKodeAlasanBalik } from "@/lib/antar-unit-queries";
import { unitDotted, unitLabel } from "@/lib/config";
import { bandingkanSaldoAwal, daftarBulan, periodeAwal, selMatriks } from "@/lib/impor-bank-model";
import { getRekeningBca, getRekeningKoranUnit, getSaldoBukuAwal } from "@/lib/impor-bank-queries";
import { canImporRekeningKoran, canTarikRekeningKoran, canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { todayWib } from "@/lib/periods";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

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
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca   → `canViewLaporanKeuangan`
 *   · unggah → `canImporRekeningKoran`
 *   · tarik  → `canTarikRekeningKoran`
 */
export default async function ImporBankPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const bolehUnggah = canImporRekeningKoran(ctx);
  const bolehTarik = canTarikRekeningKoran(ctx);
  const [rekening, semua, kodeAlasan] = await Promise.all([
    getRekeningBca(unit.unit_id),
    getRekeningKoranUnit(unit.unit_id),
    bolehTarik ? getKodeAlasanBalik() : Promise.resolve([]),
  ]);

  // Kolom: bulan cut-over terawal (atau rekening koran terawal — mis. berkas
  // pra-cut-over, AE8) s.d. bulan ini (WIB).
  const kini = todayWib().slice(0, 7);
  const awalCalon = [
    ...rekening.map((r) => r.cutOver?.slice(0, 7)).filter((x): x is string => !!x),
    ...semua.filter((s) => rekening.some((r) => r.id === s.accountId)).map((s) => s.periode),
  ].sort();
  const bulan = daftarBulan(awalCalon[0] && awalCalon[0] < kini ? awalCalon[0] : kini, kini);

  // Perbandingan saldo awal (R18) hanya untuk rekening koran AKTIF.
  const aktif = semua.filter((s) => s.status === "aktif");
  const perbandingan = new Map(
    await Promise.all(
      aktif.map(async (s) => {
        const buku = await getSaldoBukuAwal(unit.unit_id, s.accountId, periodeAwal(s.periode));
        return [s.id, bandingkanSaldoAwal({ periode: s.periode, saldoAwalSen: s.saldoAwalSen, buku })] as const;
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
            rekening={rekening.map((r) => ({ id: r.id, nama: r.nama, cutOver: r.cutOver }))}
            bulan={bulan}
            sel={sel}
            bolehUnggah={bolehUnggah}
            bolehTarik={bolehTarik}
            kodeAlasan={kodeAlasan}
          />
        )}
      </section>
    </>
  );
}
