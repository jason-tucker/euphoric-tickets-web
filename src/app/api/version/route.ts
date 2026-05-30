import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Next.js stamps a unique BUILD_ID per build, so a changed value means a new
// image is now serving. The client polls this and prompts a reload when it
// shifts. The id never changes within one running container, so we read it
// once and memoize.
let cached: string | null = null

async function buildId(): Promise<string> {
  if (cached) return cached
  try {
    cached = (await readFile(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8')).trim()
  } catch {
    cached = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'
  }
  return cached
}

export async function GET() {
  return NextResponse.json(
    { build: await buildId() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
