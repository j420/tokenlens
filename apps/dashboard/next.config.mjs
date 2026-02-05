/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@prune/shared", "@prune/db", "@prune/intelligence"],
  serverExternalPackages: ["pino"],
};

export default nextConfig;
