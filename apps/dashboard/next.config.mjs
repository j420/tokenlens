/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@prune/shared", "@prune/db", "@prune/intelligence"],
};

export default nextConfig;
