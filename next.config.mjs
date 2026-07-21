/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    serverComponentsExternalPackages: ["iconv-lite", "pdfjs-dist", "groq-sdk", "openai", "pdf-parse"],
  },
};

export default nextConfig;
