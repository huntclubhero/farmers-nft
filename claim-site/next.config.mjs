/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Privy and wagmi rely on some libraries that are not fully ESM-friendly
  // in all environments. Keep transpilePackages tight.
  transpilePackages: ["@privy-io/react-auth"],
};

export default nextConfig;
