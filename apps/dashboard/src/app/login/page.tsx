import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { auth, signIn } from "@/auth";

export const dynamic = "force-dynamic";

/** Layar login — Google OAuth (akun Google apa pun; akses ditentukan membership). */
export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <div className="auth-screen">
      <div className="card card-pad-lg auth-card">
        <Logo variant="stacked" height={104} priority />
        <p className="fs16 t-secondary mt4">
          Pengawasan &amp; analisa jaringan SPBU. Masuk dengan akun Google Anda.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
          className="mt5"
        >
          <button type="submit" className="btn-navy auth-btn">
            Masuk dengan Google
          </button>
        </form>
        <p className="fs15 t-tertiary mt4">
          Akses diberikan per-undangan. Bila akun Anda belum terdaftar, hubungi admin.
        </p>
      </div>
    </div>
  );
}
