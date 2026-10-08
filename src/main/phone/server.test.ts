import { describe, expect, test } from 'vitest'
import { funnelsPort, servesPort } from '../../integrations/tailscale'
import { allowedHost } from './server'

describe('phone server hosts', () => {
  test('this computer and Tailscale names are let in', () => {
    for (const host of ['127.0.0.1:47817', 'localhost:47817', 'desktop-perch.tail3c9a.ts.net', 'DESKTOP-PERCH.tail3c9a.ts.net:443']) {
      expect(allowedHost(host)).toBe(true)
    }
  })

  test('any other name is refused, so a page cannot rebind its own domain onto 127.0.0.1', () => {
    for (const host of [undefined, '', 'evil.example', '127.0.0.1.evil.example', 'ts.net', 'x.ts.net.evil.example', 'a..ts.net', '192.168.1.20:47817']) {
      expect(allowedHost(host)).toBe(false)
    }
  })
})

describe('tailscale serve config', () => {
  const config = (proxy: string): unknown => ({
    TCP: { '443': { HTTPS: true } },
    Web: { 'desktop-perch.tail3c9a.ts.net:443': { Handlers: { '/': { Proxy: proxy } } } },
  })

  test('finds a forward to Perch on its port', () => {
    expect(servesPort(config('http://127.0.0.1:47817'), 47817)).toBe(true)
    expect(servesPort(config('http://localhost:47817/'), 47817)).toBe(true)
  })

  test('another port, another host or no config is not a forward to Perch', () => {
    expect(servesPort(config('http://127.0.0.1:3000'), 47817)).toBe(false)
    expect(servesPort(config('http://192.168.0.5:47817'), 47817)).toBe(false)
    expect(servesPort({}, 47817)).toBe(false)
    expect(servesPort(null, 47817)).toBe(false)
  })

  test('notices when Funnel puts Perch on the public internet', () => {
    const site = 'desktop-perch.tail3c9a.ts.net:443'
    const withFunnel = { ...(config('http://127.0.0.1:47817') as object), AllowFunnel: { [site]: true } }
    expect(funnelsPort(withFunnel, 47817)).toBe(true)
    expect(funnelsPort(config('http://127.0.0.1:47817'), 47817)).toBe(false)
    expect(funnelsPort({ ...(config('http://127.0.0.1:3000') as object), AllowFunnel: { [site]: true } }, 47817)).toBe(false)
  })
})
