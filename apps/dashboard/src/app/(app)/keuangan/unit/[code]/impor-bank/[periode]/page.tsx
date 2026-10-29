import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { KlasifikasiImpor } from "@/components/keuangan/KlasifikasiImpor";
import { unitDotted, unitLabel } from "@/lib/config";
import { getKategoriMutasi } from "@/lib/keuangan-input-queries";
import { canCocokkanBank, canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { getBarisImporBulan, getBukuTanpaPasangan, getRekeningBulan } from "@/lib/klasifikasi-queries";
import { bulanSah } from "@/lib/penebusan-model";
import { todayWib } from "@/lib/periods";
import { getPihakLawan } from "@/lib/pihak-lawan-queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/**
 * Klasifikasi rekening koran per unit × bulan (rencana 2026-10-29 U11; R9,
 * R11, R21, R23, R25, R27; KTD6, KTD8).
 *
 *   · semua rekening koran BCA AKTIF bulan itu (saring rekening `?akun=`);
 *   · baris impor terurut tanggal bank, saring status & cari, sisa terbuka;
 *   · satu baris → satu formulir "Jenis penyelesaian" (cocokkan kandidat ·
 *     kategori + pihak lawan · antar unit · penebusan · pecah · parkir);
 *     baris diparkir → "Pindahkan dari penampung"; mode cocokkan N:M;
 *   · baris buku tanpa pasangan rekening itu bulan itu + selisihnya (R25).
 *
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca  → `canViewLaporanKeuangan`
 *   · tulis → `canCocokkanBank` (Keuangan; HoF tidak mengetik, §10.12)
 */
export default async function KlasifikasiImporPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; periode: string }>;
  searchParams: Promise<{ akun?: string }>;
}) {
  const { code, periode } = await params;
  const sp = await searchParams;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();
  if (!bulanSah(periode)) notFound();

  const bolehTulis = canCocokkanBank(ctx);
  const semuaRekening = await getRekeningBulan(unit.unit_id, periode);
  const rekening = sp.akun ? semuaRekening.filter((r) => r.accountId === sp.akun) : semuaRekening;
  const [baris, buku, kategori, pihak] = await Promise.all([
    getBarisImporBulan(unit.unit_id, rekening),
    getBukuTanpaPasangan(
      unit.unit_id,
      rekening.filter((r) => r.rekeningKoranId !== null).map((r) => r.accountId),
      periode,
    ),
    bolehTulis ? getKategoriMutasi(unit.unit_id) : Promise.resolve([]),
    bolehTulis ? getPihakLawan(unit.unit_id) : Promise.resolve([]),
  ]);
  const labelBulan = `${NAMA_BULAN[Number(periode.slice(5, 7)) - 1]} ${periode.slice(0, 4)}`;
  const belum = rekening.filter((r) => r.rekeningKoranId === null);

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-impor-bank"
      />
      <h1 className="text-h3 t-brand">Klasifikasi rekening koran · {labelBulan}</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)} · <a href={`/keuangan/unit/${unit.code}/impor-bank`}>kembali ke matriks impor</a>
      </div>
      <p className="fs16 t-tertiary mt2">
        Setiap baris rekening koran berakhir tercocokkan, terklasifikasi, atau diparkir. Baris yang hari banknya sudah ditutup
        dibukukan ke hari terbuka berikutnya dengan tanggal asalnya; arsip hari tertutup tidak berubah. Beban dan pendapatan
        lain-lain ikut tercatat di laba hari bukunya.
      </p>

      <form className="grid-row mt4" method="get">
        <label className="keu-fld">
          <span className="keu-label">Rekening</span>
          <select className="manual-input" name="akun" defaultValue={sp.akun ?? ""}>
            <option value="">Semua rekening BCA</option>
            {semuaRekening.map((r) => (
              <option key={r.accountId} value={r.accountId}>
                {r.nama}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-outline sm">
          Terapkan
        </button>
      </form>

      {belum.length > 0 && (
        <div className="banner warning keu-banner mt4" role="status">
          Rekening koran {labelBulan} belum diunggah untuk: {belum.map((r) => r.nama).join(", ")}.
        </div>
      )}

      <KlasifikasiImpor
        code={unit.code}
        baris={baris}
        buku={buku}
        kategori={kategori}
        pihakLawan={pihak.filter((p) => p.aktif).map((p) => ({ id: p.id, nama: p.nama, jenis: p.jenis }))}
        unitLain={scope.units.filter((u) => u.code !== unit.code).map((u) => ({ code: u.code, name: u.name }))}
        rekeningNama={Object.fromEntries(semuaRekening.map((r) => [r.accountId, r.nama]))}
        bolehTulis={bolehTulis}
        hariIni={todayWib()}
      />
    </>
  );
}
