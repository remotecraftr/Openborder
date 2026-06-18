/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prevent Next.js/webpack from bundling these — they must load at runtime
  serverExternalPackages: ['@sparticuz/chromium', 'playwright', 'playwright-core', 'axe-core'],
};

module.exports = nextConfig;
