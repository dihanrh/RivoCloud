import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep the dev-mode badge out of demos and screenshots.
  devIndicators: false,
  // Lets a production build run beside `next dev` without sharing .next (unset on Vercel).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
