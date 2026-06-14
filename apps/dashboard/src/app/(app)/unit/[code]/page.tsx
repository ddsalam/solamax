import { redirect } from "next/navigation";
import { todayWib } from "@/lib/periods";

/** Rute lama → Laporan Operasional Harian tanggal bisnis berjalan. */
export default function UnitIndex({ params }: { params: { code: string } }) {
  redirect(`/unit/${params.code}/laporan/${todayWib()}`);
}
