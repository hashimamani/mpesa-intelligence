/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @mpesa/ui ships raw TS + CSS Modules (not pre-compiled) so Next.js's own
  // pipeline processes its styles — see docs/12-design-system.md.
  transpilePackages: ["@mpesa/ui"],
};

export default nextConfig;
