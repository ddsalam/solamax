import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { TagihanRingkasanLintas, type TagihanRingkasanBaris } from "@/components/keuangan/TagihanRingkasanLintas";
import { unitDotted } from "@/lib/config";
import { rp } from "@/lib/format";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { getDataScope } from "@/lib/scope";
import { getRingkasanTagihanLintasUnit } from "@/lib/tagihan-queries";

export const dynamic = "force-dynamic";

/**
 * S5 — Ringkasan tagihan pelanggan lintas SPBU (rencana 2026-11-13 U10; R21,
 * R22, R23). **READ-ONLY.** Keputusan: `apps/dashboard/PIUTANG-PELANGGAN.md`.
 *
 * Satu baris per SPBU dalam cakupan pembaca — daftar unitnya HANYA
 * `scope.units` (dari `getDataScope()`), dan kuerinya membentuk baris hanya
 * dari larik yang diserahkan. Gerbang bacanya sama dengan layar lintas unit
 * Keuangan lain (Papan, Pemantauan).
 *
 * Layar ini tak punya dimensi unit maupun tanggal: status faktur dihitung
 * terhadap HARI INI (KTD4), bukan terhadap tanggal pilihan.
 *
 * ⚠️ Layar ini tak bisa membedakan "belum dibayar" dari "pembayaran belum
 * dicatat di EasyMax". Kolom "Pembayaran terakhir" ada supaya pembaca melihat
 * unit yang berhenti mencatat pembayaran sebelum membaca tunggakannya.
 */
export default async function RingkasanTagihanPage() {
  const scope = await getDataScope();
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const ringkasan = await getRingkasanTagihanLintasUnit(scope.units.map((u) => u.unit_id));
  const perUnit = new Map(ringkasan.unit.map((r) => [Number(r.unitId), r] as const));
  const baris: TagihanRingkasanBaris[] = scope.units.flatMap((u) => {
    const data = perUnit.get(Number(u.unit_id));
    return data ? [{ code: u.code, name: u.name, dotted: unitDotted(u.code), data }] : [];
  });

  let lewat = 0;
  let nLewat = 0;
  let belumAtur = 0;
  let belumSiap = 0;
  for (const b of baris) {
    if (!b.data.tersedia) {
      belumSiap += 1;
      continue;
    }
    lewat += b.data.ubin.lewatJatuhTempo.sisa;
    nLewat += b.data.ubin.lewatJatuhTempo.jumlah;
    belumAtur += b.data.ubin.terminBelumDiatur.jumlah;
  }

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={scope.units[0]?.code ?? ""}
        // Tanpa dimensi unit DAN tanpa tanggal: bilah ini hanya menyebut
        // cakupan. `segment` hanya dipakai kontrol tanggal & pemilih unit, dan
        // keduanya tak dirender di sini — segmen lintas-unit yang sudah ada
        // dipakai supaya tak ada pembangun URL kedua.
        segment="keuangan-papan"
        dimensiUnit="tak_berlaku"
      />
      <div className="section-h">
        <h1 className="text-h3 t-brand">Ringkasan tagihan pelanggan</h1>
      </div>
      <p className="fs16 t-tertiary mt2">
        Sisa faktur pelanggan kredit per SPBU menurut data EasyMax yang terakhir masuk, dihitung terhadap
        hari ini. Tiap angka membuka daftar faktur SPBU itu. Hanya baca.
      </p>

      <div className="kpi-grid mt6">
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Lewat jatuh tempo</div>
          <div className={`tutup-angka num ${nLewat ? "t-danger" : ""}`}>{rp(lewat)}</div>
          <div className="fs16 t-secondary">{nLewat.toLocaleString("id-ID")} faktur di semua SPBU yang datanya tersedia</div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Termin belum diatur</div>
          <div className={`tutup-angka num ${belumAtur ? "t-warning" : ""}`}>{belumAtur.toLocaleString("id-ID")}</div>
          <div className="fs16 t-secondary">faktur yang belum bisa dinilai lewat jatuh tempo atau tidak</div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">SPBU tanpa data tagihan</div>
          <div className="tutup-angka num">
            {belumSiap} / {baris.length}
          </div>
          <div className="fs16 t-secondary">belum pernah menyelesaikan satu siklus tagihan lengkap</div>
        </div>
      </div>

      <div className="section-h mt6">
        <h2 className="text-h3">Per SPBU</h2>
        <span className="fs16 t-tertiary">sisa dalam rupiah, di bawahnya jumlah faktur atau dokumen</span>
      </div>
      <TagihanRingkasanLintas baris={baris} terpotong={ringkasan.terpotong} />
    </>
  );
}
