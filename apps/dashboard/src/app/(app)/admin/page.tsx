import { notFound } from "next/navigation";
import { getDataScope } from "@/lib/scope";
import { q } from "@/lib/db";
import { grantAccess, revokeAccess } from "@/lib/admin-actions";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin_perusahaan: "Admin Perusahaan",
  direksi: "Direksi",
  pengawas: "Pengawas",
};

interface UserRow {
  id: number;
  email: string | null;
  name: string | null;
}
interface TenantRow {
  id: string;
  name: string;
}
interface UnitRow {
  unit_id: number;
  code: string;
  name: string;
  tenant_id: string | null;
}
interface MembershipRow {
  id: string;
  email: string | null;
  role: string;
  tenant_name: string | null;
  status: string;
  units: string | null; // daftar kode unit (pengawas)
}

/** Kelola Akses — TERKUNCI super_admin (cek server-side). */
export default async function AdminPage() {
  const scope = await getDataScope();
  if (!scope.isSuperAdmin) notFound(); // bukan sekadar sembunyikan menu

  const [users, tenants, units, memberships] = await Promise.all([
    q<UserRow>(`SELECT id, email, name FROM app.users ORDER BY email`),
    q<TenantRow>(`SELECT id, name FROM app.tenant WHERE status = 'active' ORDER BY name`),
    q<UnitRow>(
      `SELECT unit_id, code, name, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
    ),
    q<MembershipRow>(
      `SELECT m.id, u.email, m.role, t.name AS tenant_name, m.status,
              (SELECT string_agg(un.code, ', ' ORDER BY un.code)
                 FROM app.user_unit uu JOIN public.unit un ON un.unit_id = uu.unit_id
                WHERE uu.membership_id = m.id) AS units
       FROM app.membership m
       JOIN app.users u ON u.id = m.user_id
       LEFT JOIN app.tenant t ON t.id = m.tenant_id
       ORDER BY u.email, m.role`,
    ),
  ]);

  return (
    <div>
      <div className="text-eyebrow t-tertiary">Administrasi</div>
      <h1 className="text-h4 t-brand mt2">Kelola Akses Pengguna</h1>
      <p className="fs16 t-secondary mt2">
        Akses diberikan per-undangan. Pengguna harus login Google sekali dulu (akan muncul di
        daftar di bawah), lalu beri membership: tenant + role (+ unit untuk pengawas).
      </p>

      {/* Membership aktif */}
      <div className="mt8">
        <div className="text-h6 t-brand">Membership terdaftar ({memberships.length})</div>
        <div className="card tbl-card mt4">
          <div className="grid-head" style={{ gridTemplateColumns: "2fr 1.2fr 1.2fr 1.4fr 0.8fr" }}>
            <span>Email</span>
            <span>Role</span>
            <span>Perusahaan</span>
            <span>Unit (pengawas)</span>
            <span />
          </div>
          {memberships.map((m) => (
            <div
              key={m.id}
              className="grid-row"
              style={{ gridTemplateColumns: "2fr 1.2fr 1.2fr 1.4fr 0.8fr" }}
            >
              <span className="fs16">{m.email}</span>
              <span className="fs16">{ROLE_LABEL[m.role] ?? m.role}</span>
              <span className="fs16 t-secondary">{m.tenant_name ?? "— (lintas tenant)"}</span>
              <span className="fs16 t-secondary">{m.units ?? "—"}</span>
              <span className="right">
                {m.role !== "super_admin" && (
                  <form action={revokeAccess}>
                    <input type="hidden" name="membershipId" value={m.id} />
                    <button type="submit" className="btn-outline sm">
                      Cabut
                    </button>
                  </form>
                )}
              </span>
            </div>
          ))}
          {memberships.length === 0 && (
            <div className="empty-inline">Belum ada membership.</div>
          )}
        </div>
      </div>

      {/* Beri akses */}
      <div className="mt10">
        <div className="text-h6 t-brand">Beri / ubah akses</div>
        <form action={grantAccess} className="card card-pad-lg mt4" style={{ display: "grid", gap: "var(--space-4)" }}>
          <label className="fs15 w600 t-secondary">
            Pengguna (sudah pernah login)
            <select name="userId" required className="seg-btn" style={{ display: "block", width: "100%", marginTop: 6 }}>
              <option value="">— pilih pengguna —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} {u.name ? `(${u.name})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="fs15 w600 t-secondary">
            Role
            <select name="role" required className="seg-btn" style={{ display: "block", width: "100%", marginTop: 6 }}>
              <option value="direksi">Direksi (semua unit tenant)</option>
              <option value="admin_perusahaan">Admin Perusahaan (semua unit tenant)</option>
              <option value="pengawas">Pengawas (unit tertentu)</option>
            </select>
          </label>

          <label className="fs15 w600 t-secondary">
            Perusahaan (tenant)
            <select name="tenantId" required className="seg-btn" style={{ display: "block", width: "100%", marginTop: 6 }}>
              <option value="">— pilih tenant —</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "var(--space-3)" }}>
            <legend className="fs15 w600 t-secondary">Unit (hanya untuk Pengawas)</legend>
            <div style={{ display: "grid", gap: 6 }}>
              {units.map((u) => (
                <label key={u.unit_id} className="fs15 t-secondary" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="unitIds" value={u.unit_id} />
                  {u.code} · {u.name}
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="btn-navy" style={{ justifySelf: "start" }}>
            Simpan akses
          </button>
        </form>
        <p className="fs15 t-tertiary mt3">
          super_admin tidak diberikan di sini (hanya lewat SUPERADMIN_EMAILS). Pengawas tanpa unit
          terpilih = tidak melihat data apa pun (default-deny).
        </p>
      </div>
    </div>
  );
}
