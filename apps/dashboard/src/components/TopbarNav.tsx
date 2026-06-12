"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Nav topbar (№9): Ringkasan → /board; Tren non-aktif "menyusul"; Anomali → feed. */
export function TopbarNav() {
  const path = usePathname();
  return (
    <div className="topnav no-print">
      <Link href="/board" className={path.startsWith("/board") ? "active" : ""}>
        Ringkasan
      </Link>
      <span className="disabled" title="menyusul">
        Tren
      </span>
      <Link
        href="/monitoring/anomali"
        className={path.startsWith("/monitoring/anomali") ? "active" : ""}
      >
        Anomali
      </Link>
    </div>
  );
}
