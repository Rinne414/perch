import { describe, expect, test } from 'vitest'
import type { UpdateStatus } from '@shared/ipc'
import { createUpdateState, updateErrorText } from './update'

const track = (): { seen: UpdateStatus[]; state: ReturnType<typeof createUpdateState> } => {
  const seen: UpdateStatus[] = []
  return { seen, state: createUpdateState((s) => seen.push(s)) }
}

describe('update state', () => {
  test('goes from checking to downloading to ready, in whole percents', () => {
    const { seen, state } = track()
    state.checking()
    state.found('0.2.0')
    state.progress(0.4)
    state.progress(12.2)
    state.progress(12.9)
    state.progress(100)
    state.downloaded('0.2.0')
    expect(seen).toEqual([
      { state: 'checking' },
      { state: 'downloading', version: '0.2.0', percent: 0 },
      { state: 'downloading', version: '0.2.0', percent: 12 },
      { state: 'downloading', version: '0.2.0', percent: 100 },
      { state: 'ready', version: '0.2.0' },
    ])
  })

  test('only one check or download runs at a time, and a ready update is not checked again', () => {
    const { state } = track()
    expect(state.canCheck()).toBe(true)
    state.checking()
    expect(state.canCheck()).toBe(false)
    state.found('0.2.0')
    expect(state.canCheck()).toBe(false)
    state.downloaded('0.2.0')
    expect(state.canCheck()).toBe(false)
  })

  test('can check again after "latest" or an error', () => {
    const { state } = track()
    state.checking()
    state.latest()
    expect(state.canCheck()).toBe(true)
    state.checking()
    state.failed(new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(state.current()).toEqual({ state: 'error', message: '連不上 GitHub，檢查一下網路再試一次' })
    expect(state.canCheck()).toBe(true)
  })

  test('the updater announcing a check it was asked for is not a second change', () => {
    const { seen, state } = track()
    state.checking()
    state.checking()
    expect(seen).toHaveLength(1)
  })

  test('a system that installs by hand hears about the version and can check again', () => {
    const { state } = track()
    state.checking()
    state.manual('0.2.0')
    expect(state.current()).toEqual({ state: 'manual', version: '0.2.0' })
    expect(state.canCheck()).toBe(true)
  })

  test('progress outside a download is ignored', () => {
    const { seen, state } = track()
    state.progress(50)
    expect(seen).toEqual([])
  })
})

describe('update errors', () => {
  test('say what the person can do about them', () => {
    expect(updateErrorText(new Error('getaddrinfo ENOTFOUND api.github.com'))).toMatch(/網路/)
    expect(updateErrorText(new Error('HttpError: 404 Not Found'))).toMatch(/還沒有可以更新的版本/)
    expect(updateErrorText(new Error('sha512 checksum mismatch, expected x'))).toMatch(/對不上/)
    expect(updateErrorText(new Error('ENOSPC: no space left on device'))).toMatch(/磁碟空間/)
    expect(updateErrorText('something else')).toMatch(/記錄檔/)
  })
})
