import { describe, it, expect } from 'vitest'
import { safeTranscriptUrl } from './transcript'

describe('safeTranscriptUrl', () => {
  it('passes http(s) URLs through', () => {
    expect(safeTranscriptUrl('https://i.tucker.host/i/qVx79Apa')).toBe('https://i.tucker.host/i/qVx79Apa')
    expect(safeTranscriptUrl('http://example.com/t/1')).toBe('http://example.com/t/1')
    expect(safeTranscriptUrl('  https://tickettool.xyz/transcript/abc  ')).toBe('https://tickettool.xyz/transcript/abc')
  })

  it('returns null for empty values', () => {
    expect(safeTranscriptUrl(null)).toBeNull()
    expect(safeTranscriptUrl(undefined)).toBeNull()
    expect(safeTranscriptUrl('')).toBeNull()
    expect(safeTranscriptUrl('   ')).toBeNull()
  })

  it('rejects non-http schemes', () => {
    for (const raw of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/x',
    ]) {
      expect(safeTranscriptUrl(raw), raw).toBeNull()
    }
  })

  it('rejects relative or malformed URLs', () => {
    for (const raw of ['/i/qVx79Apa', 'i.tucker.host/i/qVx79Apa', 'https://', 'not a url']) {
      expect(safeTranscriptUrl(raw), raw).toBeNull()
    }
  })
})
