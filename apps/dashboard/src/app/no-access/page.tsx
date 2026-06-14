import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getAuthContext } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

/** Login sukses TAPI tanpa membership → invite-gated, nol data. */
export default async function NoAccessPage() {
  const state = await getAuthContext();
  if (state.status === "unauthenticated") redirect("/login");
  if (state.status === "ok") redirect("/");
  const email = state.email;

  return (
    <div className="auth-screen">
      <div className="card card-pad-lg auth-card">
        <div className="empty-hero-icon">—</div>
        <div className="text-h5 t-primary mt4">Akun belum diberi akses</div>
        <p className="fs16 t-secondary mt2">
          Anda masuk sebagai <strong>{email ?? "akun Google"}</strong>, tetapi akun ini belum
          terdaftar pada perusahaan/SPBU mana pun. Hubungi admin untuk diberi akses.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="mt5"
        >
          <button type="submit" className="btn-outline">
            Keluar
          </button>
        </form>
      </div>
    </div>
  );
}
