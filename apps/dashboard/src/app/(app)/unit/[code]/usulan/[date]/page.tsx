import Link from "next/link";
import { notFound } from "next/navigation";
import { UsulanToolbar } from "@/components/usulan/Toolbar";
import { unitDotted } from "@/lib/config";
import { dateLong, dateShort, fmtL, timeWib } from "@/lib/format";
import { getUsulanSoList } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function UsulanListPage({
  params,
}: {
  params: { code: string; date: string };
}) {
  if (!DATE_RE.test(params.date)) notFound();
  const scope = await getDataScope();
  const unit = scope.requireUnit(params.code); // notFound bila di luar scope/tak ada
  const date = params.date;

  const list = await getUsulanSoList(unit.unit_id);

  return (
    <div className="lap-page">
      <UsulanToolbar code={unit.code} date={date} mode="list" />

      <div className="board-head mt6">
        <div>
          <div className="text-eyebrow t-tertiary">
            Usulan Penebusan SO · SPBU {unitDotted(unit.code)}
          </div>
          <h1 className="text-h3 t-brand mt2">{unit.name}</h1>
          <div className="fs16 t-secondary mt2">
            Riwayat usulan penebusan DO yang disimpan pengawas · ditujukan ke Keuangan
          </div>
        </div>
      </div>

      <div className="card tbl-card mt8">
        <div className="grid-head cols-usulan-list">
          <span>Tanggal</span>
          <span className="right">Total Penerimaan Hari</span>
          <span className="right">Total Permintaan Besok</span>
          <span className="right">Total Usulan Penebusan</span>
          <span>Status</span>
          <span className="right">Terakhir disimpan</span>
        </div>
        {list.length === 0 ? (
          <div className="empty-inline">
            Belum ada usulan tersimpan. Gunakan &ldquo;Buat / edit usulan&rdquo; untuk membuat.
          </div>
        ) : (
          list.map((u) => (
            <Link
              key={u.date}
              href={`/unit/${unit.code}/usulan/${u.date}/edit`}
              className="grid-row cols-usulan-list clickable"
            >
              <span className="text-caption w600 t-primary">{dateShort(u.date)}</span>
              <span className="right fs16 num">{fmtL(u.totalPenerimaan)}</span>
              <span className="right fs16 num">{fmtL(u.totalPermintaan)}</span>
              <span className="right fs16 num w600">{fmtL(u.totalUsulan)}</span>
              <span>
                <span className={`status-pill ${u.status === "diajukan" ? "diajukan" : "draft"}`}>
                  {u.status === "diajukan" ? "Diajukan" : "Draft"}
                </span>
              </span>
              <span className="right fs15 t-tertiary num">
                {u.lastSavedAt ? `${dateShort(u.lastSavedAt.slice(0, 10))} ${timeWib(u.lastSavedAt)}` : "—"}
              </span>
            </Link>
          ))
        )}
      </div>

      <div className="page-foot mt8">
        <span>Pilih tanggal di topbar lalu &ldquo;Buat / edit usulan&rdquo; untuk tanggal itu.</span>
        <span>Hari aktif: {dateLong(date)}</span>
      </div>
    </div>
  );
}
