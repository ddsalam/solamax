import { rp } from "@/lib/format";
import {
  BATAS_BARIS_TAGIHAN,
  type TagihanBelumTersedia as TagihanBelumTersediaHasil,
  type TagihanPelanggan,
} from "@/lib/tagihan-queries";
import { tagihanBukaHref, tagihanKesegaranLabel, tagihanListHref } from "@/lib/tagihan-route";
import {
  TagihanBelumTersedia,
  TagihanCocokSaldo,
  TagihanFakturTabel,
  TagihanPembayaranTabel,
  tanggalTagihan,
  totalPembayaranHidup,
} from "./TagihanTabel";

/** Tautan ke S3 tanpa pencarian dan tanpa periode — hanya kelompok pelanggan ini yang dibuka. */
const TANPA_SARINGAN = {
  tampilan: "belum_ditagihkan",
  search: "",
  periode: { from: "", to: "" },
  periodeBawaan: true,
} as const;

/**
 * S6 — seksi "Tagihan" dan "Pembayaran" di halaman pelanggan Saldo pelanggan
 * (rencana 2026-11-13 U8; R18). Menggantikan kartu "Aktivitas pelanggan" Fase 1.
 *
 * ⚠️ Halaman induknya ber-TANGGAL (saldo per tanggal itu); seksi ini TIDAK:
 * faktur dan pembayaran di sini adalah keadaan terbaru dari EasyMax, dan
 * statusnya dihitung terhadap hari ini. Itu dikatakan di layar, supaya angka
 * di sini tidak dibaca sebagai posisi pada tanggal saldo.
 */
export function TagihanPelangganSeksi({
  unit,
  data,
}: {
  unit: { code: string; name: string };
  data: TagihanBelumTersediaHasil | TagihanPelanggan;
}) {
  if (!data.tersedia) {
    return (
      <section aria-label="Tagihan dan pembayaran pelanggan">
        <TagihanBelumTersedia unit={unit} />
      </section>
    );
  }
  const { belumDitagihkan } = data;
  return (
    <>
      <section className="card b6-piutang-list" aria-labelledby="tagihan-pelanggan-judul">
        <div className="b6-piutang-list-meta">
          <div>
            <h2 id="tagihan-pelanggan-judul">Tagihan</h2>
            <p>
              {data.faktur.length.toLocaleString("id-ID")} faktur, termasuk yang lunas · keadaan terbaru, status dihitung per hari ini — bukan posisi pada tanggal saldo di atas
            </p>
            <p>{tagihanKesegaranLabel(data.kesiapan.selesaiAt)}</p>
          </div>
          <a className="btn-outline no-print" href={tagihanListHref(unit.code)}>Daftar tagihan SPBU</a>
        </div>
        {data.terpotong && (
          <p className="tagihan-catatan">
            Hanya {BATAS_BARIS_TAGIHAN.toLocaleString("id-ID")} faktur pertama yang ditampilkan; daftar ini tidak lengkap.
          </p>
        )}
        {data.faktur.length === 0 ? (
          <div className="empty-inline b6-piutang-empty">Pelanggan ini belum punya faktur.</div>
        ) : (
          <TagihanFakturTabel
            unitCode={unit.code}
            baris={data.faktur}
            tampilkanPelanggan={false}
            label={`Faktur pelanggan ${data.customerCode}`}
          />
        )}
        <div className="tagihan-kelompok">
          <p className="tagihan-catatan">
            Belum ditagihkan: {belumDitagihkan.jumlahDokumen.toLocaleString("id-ID")} dokumen · {rp(belumDitagihkan.total)}
            {belumDitagihkan.tanggalTertua && ` · tertua ${tanggalTagihan(belumDitagihkan.tanggalTertua)}`}
            {belumDitagihkan.jumlahDokumen > 0 && (
              <>
                {" · "}
                <a href={tagihanBukaHref(unit.code, TANPA_SARINGAN, data.customerCode)}>
                  Lihat dokumennya
                </a>
              </>
            )}
          </p>
          {data.saldoSedangDiperbarui && (
            <p className="tagihan-catatan" data-tagihan-saldo-diperbarui>
              Saldo pelanggan per {tanggalTagihan(data.cocokSaldo.saldoPerTanggal)} sedang diperbarui; saldo piutang dan selisih di bawah bisa berubah.
            </p>
          )}
          <TagihanCocokSaldo cocok={data.cocokSaldo} />
        </div>
      </section>

      <section className="card b6-piutang-list" aria-labelledby="pembayaran-pelanggan-judul">
        <div className="b6-piutang-list-meta">
          <div>
            <h2 id="pembayaran-pelanggan-judul">Pembayaran</h2>
            <p>
              {data.pembayaran.length.toLocaleString("id-ID")} pembayaran tercatat di semua faktur · {rp(totalPembayaranHidup(data.pembayaran))} dihitung · terbaru dulu
            </p>
          </div>
        </div>
        {data.pembayaranTerpotong && (
          <p className="tagihan-catatan" data-tagihan-bayar-terpotong>
            Hanya {BATAS_BARIS_TAGIHAN.toLocaleString("id-ID")} pembayaran terbaru yang ditampilkan; daftar dan total pembayaran ini tidak lengkap.
          </p>
        )}
        {data.pembayaran.length === 0 ? (
          <div className="empty-inline b6-piutang-empty">Belum ada pembayaran tercatat untuk pelanggan ini.</div>
        ) : (
          <TagihanPembayaranTabel
            pembayaran={data.pembayaran}
            unitCode={unit.code}
            label={`Pembayaran pelanggan ${data.customerCode}`}
          />
        )}
      </section>
    </>
  );
}
