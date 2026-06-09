import { describe, it, expect } from 'vitest'
import { isPrivateOrReservedIp, parseSafeHttpUrl, assertPublicHttpUrl, BlockedUrlError } from './ssrf'

describe('isPrivateOrReservedIp', () => {
  it('flags IPv4 loopback / private / CGNAT ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '127.255.255.255',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '100.64.0.1', // CGNAT
      '0.0.0.0',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true)
    }
  })

  it('flags the cloud metadata link-local address', () => {
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true)
    expect(isPrivateOrReservedIp('169.254.0.1')).toBe(true)
  })

  it('flags multicast / reserved / broadcast', () => {
    expect(isPrivateOrReservedIp('224.0.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('240.0.0.1')).toBe(true)
    expect(isPrivateOrReservedIp('255.255.255.255')).toBe(true)
  })

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false)
    }
  })

  it('handles IPv6 loopback / ULA / link-local and v4-mapped', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true)
    expect(isPrivateOrReservedIp('::')).toBe(true)
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true)
    expect(isPrivateOrReservedIp('febf::1')).toBe(true) // top of fe80::/10
    expect(isPrivateOrReservedIp('fec0::1')).toBe(true) // deprecated site-local
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true)
    expect(isPrivateOrReservedIp('fd12:3456::1')).toBe(true)
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true) // v4-mapped loopback
    expect(isPrivateOrReservedIp('ff02::1')).toBe(true) // multicast
  })

  it('allows public IPv6', () => {
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false) // cloudflare
    expect(isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(false) // google
  })

  it('fails closed on garbage input', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true)
    expect(isPrivateOrReservedIp('')).toBe(true)
    expect(isPrivateOrReservedIp('999.999.999.999')).toBe(true)
  })
})

describe('parseSafeHttpUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(parseSafeHttpUrl('https://ntfy.sh')?.hostname).toBe('ntfy.sh')
    expect(parseSafeHttpUrl('http://ntfy.example.com/my-topic')?.hostname).toBe('ntfy.example.com')
    expect(parseSafeHttpUrl('https://[2606:4700:4700::1111]/')).not.toBeNull()
  })

  it('rejects private / loopback / metadata IP literals', () => {
    for (const u of [
      'https://127.0.0.1',
      'http://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5',
      'http://192.168.1.1:9000',
      'https://[::1]/',
    ]) {
      expect(parseSafeHttpUrl(u), u).toBeNull()
    }
  })

  it('rejects internal-only hostnames and bare single-label hosts', () => {
    for (const u of ['https://localhost', 'http://db', 'https://tickets-web', 'https://foo.internal', 'http://printer.local']) {
      expect(parseSafeHttpUrl(u), u).toBeNull()
    }
  })

  it('rejects non-http(s) schemes and malformed input', () => {
    for (const u of ['ftp://ntfy.sh', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://x', 'not a url', '']) {
      expect(parseSafeHttpUrl(u), u).toBeNull()
    }
  })
})

describe('assertPublicHttpUrl', () => {
  it('resolves for a public IP literal without DNS', async () => {
    await expect(assertPublicHttpUrl('https://1.1.1.1/topic')).resolves.toBeInstanceOf(URL)
  })

  it('rejects private literals, internal names and bad schemes', async () => {
    for (const u of ['https://127.0.0.1', 'http://169.254.169.254/', 'https://localhost', 'http://db', 'ftp://ntfy.sh']) {
      await expect(assertPublicHttpUrl(u), u).rejects.toBeInstanceOf(BlockedUrlError)
    }
  })
})
