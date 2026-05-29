import { formatDistanceToNowStrict } from 'date-fns'

export function relativeTime(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  return formatDistanceToNowStrict(d, { addSuffix: true })
}

export function avatarUrl(discordId: string, hash: string | null | undefined, size = 64): string {
  if (!hash) {
    // Default avatar — index 0..5, picked by the user-id-low-bits trick that
    // matches Discord's own default-avatar algorithm.
    const idx = Number(BigInt(discordId) >> 22n) % 6
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`
  }
  const ext = hash.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${discordId}/${hash}.${ext}?size=${size}`
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-status-open/15 text-status-open border border-status-open/30'
    case 'claimed':
      return 'bg-status-claimed/15 text-status-claimed border border-status-claimed/30'
    case 'waiting':
      return 'bg-status-waiting/15 text-status-waiting border border-status-waiting/30'
    case 'closed':
      return 'bg-status-closed/15 text-status-closed border border-status-closed/30'
    default:
      return 'bg-muted text-muted-foreground'
  }
}
