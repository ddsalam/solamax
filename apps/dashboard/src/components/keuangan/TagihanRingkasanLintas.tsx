import Link from "next/link";
import { dateShort, rp } from "@/lib/format";
import { formatWib } from "@/lib/piutang-route";
import { TAGIHAN_BELUM_TERSEDIA, type RingkasanTagihanUnit } from "@/lib/tagihan-queries";
import { tagihanListHref, tagihanTampilanHref, type TagihanTampilan } from "@/lib/tagihan-route";

/**
 * S5 — tabel ringkasan tagihan lintas SPBU (rencana 2026-11-13 U10; R21, R22).
 * Murni tampilan: barisnya HANYA dari `baris` yang diserahkan halaman, dan
 * halaman hanya menyerahkan unit dalam cakupan pembaca.
 *
 * Tiap angka menaut ke daftar unit itu (S1) dengan tampilan yang memuatnya.
 * ⚠️ "Belum jatuh tempo" dan "Termin belum diatur" tak punya saringan sendiri
 * di S1 — keduanya menaut ke "Perlu tindakan", saringan tersempit yang memuat
 * faktur-faktur itu. Menaut ke saringan yang tak memuatnya akan menampilkan
 * daftar yang jumlahnya tak cocok dengan angka yang baru diklik.
 *
 * Unit yang belum pernah menyelesaikan satu siklus tagihan ditulis "belum
 * tersedia" di barisnya — tak pernah sebagai nol (KTD11).
 */
export interface TagihanRingkasanBaris {
  code: string;
  name: string;
  /** Kode bertitik untuk tampilan (mis. dari `unitDotted`). */
  dotted: string;
  data: RingkasanTagihanUnit;
}

const TAMPILAN_SEL = {
  lewatJatuhTempo: "lewat_jatuh_tempo",
  belumJatuhTempo: "perlu_tindakan",
  terminBelumDiatur: "perlu_tindakan",
  belumDitagihkan: "belum_ditagihkan",
} as const satisfies Record<string, TagihanTampilan>;

function Sel({
  code,
  tampilan,
  rupiah,
  jumlah,
  satuan,
  nada,
}: {
  code: string;
  tampilan: TagihanTampilan;
  rupiah: number;
  jumlah: number;
  satuan: string;
  nada?: "t-danger" | "t-warning";
}) {
  return (
    <span className="right">
      <Link href={tagihanTampilanHref(code, tampilan)} className={`num w600${jumlah > 0 && nada ? ` ${nada}` : ""}`}>
        {rp(rupiah)}
      </Link>
      <br />
      <span className="fs15 t-tertiary num">
        {jumlah.toLocaleString("id-ID")} {satuan}
      </span>
    </span>
  );
}

export function TagihanRingkasanLintas({
  baris,
  terpotong,
}: {
  baris: TagihanRingkasanBaris[];
  /** Batas baris gabungan terlampaui: angka TIDAK lengkap. */
  terpotong: boolean;
}) {
  if (baris.length === 0) {
    return <div className="empty-inline">Tidak ada SPBU dalam cakupan Anda.</div>;
  }
  return (
    <>
      {terpotong && (
        <div className="banner danger keu-banner" role="alert" data-ringkasan-terpotong>
          <b>Angka di bawah tidak lengkap</b>
          <p className="keu-p">
            Jumlah faktur gabungan melampaui batas baca satu halaman. Buka daftar tiap SPBU untuk angka yang
            lengkap.
          </p>
        </div>
      )}
      <div className="card tbl-card tbl-scroll mt4">
        <div className="grid-head cols-arus">
          <span>SPBU</span>
          <span className="right">Lewat jatuh tempo</span>
          <span className="right">Belum jatuh tempo</span>
          <span className="right">Termin belum diatur</span>
          <span className="right">Belum ditagihkan</span>
          <span>Pembayaran terakhir</span>
          <span>Data masuk</span>
          <span />
        </div>
        {baris.map(({ code, name, dotted, data }) =>
          data.tersedia ? (
            <div className="grid-row cols-arus" key={code} data-ringkasan-unit={code}>
              <span className="w600">
                <Link href={tagihanListHref(code)}>{name}</Link>
                <br />
                <span className="fs15 t-tertiary mono">{dotted}</span>
              </span>
              <Sel
                code={code}
                tampilan={TAMPILAN_SEL.lewatJatuhTempo}
                rupiah={data.ubin.lewatJatuhTempo.sisa}
                jumlah={data.ubin.lewatJatuhTempo.jumlah}
                satuan="faktur"
                nada="t-danger"
              />
              <Sel
                code={code}
                tampilan={TAMPILAN_SEL.belumJatuhTempo}
                rupiah={data.ubin.belumJatuhTempo.sisa}
                jumlah={data.ubin.belumJatuhTempo.jumlah}
                satuan="faktur"
              />
              <Sel
                code={code}
                tampilan={TAMPILAN_SEL.terminBelumDiatur}
                rupiah={data.ubin.terminBelumDiatur.sisa}
                jumlah={data.ubin.terminBelumDiatur.jumlah}
                satuan="faktur"
                nada="t-warning"
              />
              <Sel
                code={code}
                tampilan={TAMPILAN_SEL.belumDitagihkan}
                rupiah={data.ubin.belumDitagihkan.total}
                jumlah={data.ubin.belumDitagihkan.jumlahDokumen}
                satuan="dokumen"
              />
              <span className="fs16" data-ringkasan-bayar-terakhir>
                {data.pembayaranTerakhir === null ? (
                  <span className="t-warning">belum ada pembayaran tercatat</span>
                ) : (
                  dateShort(data.pembayaranTerakhir)
                )}
              </span>
              <span className="fs15 t-secondary" data-ringkasan-kesegaran>
                {formatWib(data.kesiapan.selesaiAt)}
              </span>
              <span className="right">
                <Link className="fs16" href={tagihanListHref(code)} aria-label={`Buka tagihan ${name}`}>
                  Buka
                </Link>
              </span>
            </div>
          ) : (
            <div className="grid-row cols-pantau" key={code} data-ringkasan-unit={code} data-ringkasan-belum-tersedia>
              <span className="w600">
                {name}
                <br />
                <span className="fs15 t-tertiary mono">{dotted}</span>
              </span>
              <span className="fs16 t-tertiary">{TAGIHAN_BELUM_TERSEDIA}</span>
            </div>
          ),
        )}
      </div>
    </>
  );
}
