import type { NextConfig } from 'next'
import { readFileSync } from 'node:fs'

// Read the app semver from package.json at build time and expose it to the
// client + server bundles. The site footer renders it; the /api/version route
// also falls back to it when the Next BUILD_ID can't be read.
const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }

const nextConfig: NextConfig = {
  // Surface the package.json semver (e.g. "0.7.1") to the app via
  // process.env.NEXT_PUBLIC_APP_VERSION — inlined into the bundle at build.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },

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
