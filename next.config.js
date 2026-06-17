/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow serverless functions up to 60s on Vercel free tier
  experimental: {},
};

module.exports = nextConfig;
