import { describe, expect, test } from 'vitest'
import { issueUrl } from './report'

describe('report a problem', () => {
  test('opens a new issue on the public repo with the version and Windows build filled in', () => {
    const url = new URL(issueUrl('0.1.0', '10.0.26200', 'x64'))
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/Rinne414/perch/issues/new')
    const body = url.searchParams.get('body') ?? ''
    expect(body).toContain('Perch 0.1.0 · Windows 10.0.26200 · x64')
    expect(body).toContain('perch.log')
  })
})
