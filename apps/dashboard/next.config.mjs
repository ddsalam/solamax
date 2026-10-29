/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone → siap container Cloud Run saat staging deploy nanti
  output: "standalone",
  experimental: {
    serverActions: {
      // Unggah e-statement BCA (rencana 2026-10-29 U9, KTD10): berkas nyata
      // 30–75 KB. Batas ini berlaku untuk SEMUA server action, jadi dinaikkan
      // ke nilai terkecil yang memuatnya dengan lega (bawaan Next 1 MB juga,
      // tetapi ditulis eksplisit supaya kenaikan berikutnya terlihat sebagai
      // keputusan). Berkas dibatasi 1.000.000 byte di aksi & komponen
      // (`MAKS_BERKAS_BYTE`), sedikit di bawah batas badan multipart ini.
      bodySizeLimit: "1mb",
    },
  },
};

export default nextConfig;
