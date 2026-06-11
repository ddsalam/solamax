import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata: Metadata = {
  title: "SolaMax — Pengawasan SPBU",
  description: "Dashboard pengawasan kepatuhan input EasyMax lintas SPBU SolaGroup",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <header className="top">
          <h1>
            <Link href="/" style={{ color: "inherit" }}>
              ⛽ SolaMax
            </Link>
          </h1>
          <span className="sub">
            Pengawasan kepatuhan input EasyMax — read-only, refresh otomatis 60 dtk
          </span>
          <AutoRefresh seconds={60} />
        </header>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
