/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone → siap container Cloud Run saat staging deploy nanti
  output: "standalone",
};

export default nextConfig;
