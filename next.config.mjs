/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["iconv-lite", "pdf-parse"],
  },
};

export default nextConfig;
