import { signOut } from "@/auth";

/** Tombol keluar (server action) — sesi DB dicabut. */
export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" className="btn-outline">
        Keluar
      </button>
    </form>
  );
}
