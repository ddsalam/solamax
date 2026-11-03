import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { BukuBesarPanel, TAB_BUKU_BESAR, type TabBukuBesar } from "@/components/keuangan/BukuBesarPanel";
import type { PosIsian } from "@/components/keuangan/BukuBesarAksi";
import { bulanSah, geserBulan, rentangBulan } from "@/lib/bulan";
import { susunLaporan, temuanBeda } from "@/lib/buku-besar-laporan-model";
import { normalDebet, posKasBank } from "@/lib/buku-besar-memorial-model";
import { MULAI_BUKU_BESAR } from "@/lib/buku-besar-model";
import { BATAS_JURNAL_POS, getBahanBukuBesar, getJurnalPos, getMemorial, getPembandingRumus, kasPerPos } from "@/lib/buku-besar-queries";
import { unitDotted, unitLabel } from "@/lib/config";
import {
  canIsiSaldoAwalPos,
  canSetujuiMemorial,
  canTutupBulan,
  canUsulkanMemorial,
  canViewLaporanKeuangan,
} from "@/lib/keuangan-wewenang";
import { todayWib } from "@/lib/periods";
import { getDataScope } from "@/lib/scope";
import { ukur } from "@/lib/ukur-kueri";

export const dynamic = "force-dynamic";

const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/**
 * BUKU BESAR per unit × bulan (rencana 2026-11-02 K6 U9; R8–R10, R12, KTD10).
 *
 * Neraca dan laba-rugi formal per pos dari jurnal tersimpan, temuan beda
 * terhadap laporan rumus, saldo awal 30 Sep 2026, dan jurnal memorial.
 *
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca                         → `canViewLaporanKeuangan`
 *   · saldo awal pos               → `canIsiSaldoAwalPos` (HoF)
 *   · ketik / tarik / balik memorial → `canUsulkanMemorial` (HoF)
 *   · setujui / tolak memorial     → `canSetujuiMemorial` (Direksi, bukan pengusul)
 *   · bentuk ulang bulan ini       → `canTutupBulan` (HoF, sama dengan aksi U8)
 *
 * Temuan beda membaca laporan rumus per hari (berat) — hanya saat tabnya dibuka.
 */
export default async function BukuBesarPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; bulan: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code, bulan } = await params;
  const sp = await searchParams;
  if (!bulanSah(bulan) || bulan < MULAI_BUKU_BESAR.slice(0, 7)) notFound();
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const tab: TabBukuBesar = TAB_BUKU_BESAR.find((t) => t === sp.tab) ?? "neraca";
  const pos = typeof sp.pos === "string" && /^[1-5]\d{3}$/.test(sp.pos) ? sp.pos : null;
  const hariIni = todayWib();
  if (bulan > hariIni.slice(0, 7)) notFound();
  const [awal, akhir] = rentangBulan(bulan);

  const wewenang = {
    userId: scope.userId,
    bolehSetujui: canSetujuiMemorial(ctx),
    bolehUsul: canUsulkanMemorial(ctx),
    bolehSaldoAwal: canIsiSaldoAwalPos(ctx),
    bolehBentukUlang: canTutupBulan(ctx),
  };

  const [bahan, jurnalPos, pembanding, memorial] = await ukur("lain", () =>
    Promise.all([
      getBahanBukuBesar(unit.unit_id, bulan),
      pos !== null && (tab === "neraca" || tab === "laba-rugi") ? getJurnalPos(unit.unit_id, bulan, pos) : null,
      tab === "temuan" ? getPembandingRumus(unit.unit_id, bulan, hariIni) : null,
      tab === "memorial" || wewenang.bolehSetujui ? getMemorial(unit.unit_id, bulan) : null,
    ]),
  );
  const lap = susunLaporan(bahan);

  const namaPos = (kode: string) => bahan.daftar.find((p) => p.kode === kode)?.nama ?? `Pos ${kode}`;
  const bolehDijurnal = bahan.daftar.filter((p) => !p.induk && p.kode !== "3900");
  const isian: PosIsian[] = bolehDijurnal
    .filter((p) => (p.jenis === "aset" || p.jenis === "kewajiban" || p.jenis === "modal") && !posKasBank(p))
    .map((p) => {
      const debet = normalDebet(p);
      const s = bahan.saldoAwal.find((x) => x.posKode === p.kode && x.sumber === "akuntan")?.saldoSen ?? 0;
      const normal = debet ? s : -s;
      return { kode: p.kode, nama: p.nama, sisi: debet ? "debet" : "kredit", awal: normal === 0 ? "" : String(normal / 100) };
    });

  const sampaiBentuk = akhir < hariIni ? akhir : hariIni;
  const dariBentuk = awal < MULAI_BUKU_BESAR ? MULAI_BUKU_BESAR : awal;
  const labelBulan = `${NAMA_BULAN[Number(bulan.slice(5, 7)) - 1]} ${bulan.slice(0, 4)}`;
  const sebelum = geserBulan(bulan, -1);
  const sesudah = geserBulan(bulan, 1);
  const q = tab === "neraca" ? "" : `?tab=${tab}`;

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-buku-besar"
        date={`${bulan}-01`}
        today={hariIni}
        maxDate={hariIni}
      />
      <h1 className="text-h3 t-brand">Buku besar · {labelBulan}</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)}
        {sebelum >= MULAI_BUKU_BESAR.slice(0, 7) && (
          <>
            {" · "}
            <a href={`/keuangan/unit/${unit.code}/buku-besar/${sebelum}${q}`}>‹ {sebelum}</a>
          </>
        )}
        {sesudah <= hariIni.slice(0, 7) && (
          <>
            {" · "}
            <a href={`/keuangan/unit/${unit.code}/buku-besar/${sesudah}${q}`}>{sesudah} ›</a>
          </>
        )}
      </div>
      <p className="fs16 t-tertiary mt2">
        Neraca dan laba-rugi formal per pos, dibaca dari jurnal buku besar. Jurnal dibentuk otomatis dari catatan harian; Head of Finance mengisi
        saldo awal dan jurnal memorial. Laporan rumus tetap tersedia sebagai pembanding.
      </p>

      <BukuBesarPanel
        code={unit.code}
        bulan={bulan}
        tab={tab}
        pos={pos}
        lap={lap}
        keadaan={bahan.keadaan}
        wewenang={wewenang}
        rentangBentuk={dariBentuk <= sampaiBentuk ? { dari: dariBentuk, sampai: sampaiBentuk } : null}
        jurnalPos={jurnalPos === null ? null : { jurnal: jurnalPos.slice(0, BATAS_JURNAL_POS), terpotong: jurnalPos.length > BATAS_JURNAL_POS }}
        temuan={pembanding === null ? null : { batas: pembanding.batas, baris: temuanBeda(lap, pembanding.angka, bahan.daftar) }}
        memorial={memorial}
        saldoAwal={
          tab === "saldo-awal"
            ? {
                isian,
                kas: kasPerPos(bahan.kasPembuka).map((k) => ({ kode: k.posKode, nama: namaPos(k.posKode), saldoSen: k.saldoSen })),
                tersimpan: bahan.saldoAwal.map((s) => ({ kode: s.posKode, nama: namaPos(s.posKode), saldoSen: s.saldoSen, sumber: s.sumber })),
                rekening: [...bahan.kasPembuka],
              }
            : null
        }
        pilihanPos={bolehDijurnal.map((p) => ({ kode: p.kode, nama: p.nama }))}
        tanggalMemorial={sampaiBentuk}
      />
    </>
  );
}
