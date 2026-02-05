/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@prune/shared", "@prune/db", "@prune/intelligence"],
  experimental: {
    serverComponentsExternalPackages: ["pino"],
  },
};

export default nextConfig;
