import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Build a standalone server bundle so the Docker production image stays tiny
  // and starts without `pnpm install`. Without this, the runtime stage would
  // need to copy all of node_modules.
  output: 'standalone',

  // Discord CDN avatars + bot-uploaded files. The Discord media domain set.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
      { protocol: 'https', hostname: 'media.discordapp.net' },
    ],
  },

  // tickets.euphoric.fm is embedded inside the EuphoricFM in-game phone CEF
  // iframe (same as info.euphoric.fm). Disabling powered-by header is a
  // minor hardening cosmetic.
  poweredByHeader: false,
}

export default nextConfig
