import { describe, expect, test } from 'vitest'
import { coalesce } from './coalesce'

/** A task whose runs finish only when the test says so. */
function controlled() {
  const pending: (() => void)[] = []
  let started = 0
  const task = (): Promise<void> => {
    started++
    return new Promise((resolve) => pending.push(resolve))
  }
  const finish = async (): Promise<void> => {
    pending.shift()?.()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { task, finish, started: () => started }
}

describe('coalesce', () => {
  test('one run at a time; a burst while it runs ends in exactly one more', async () => {
    const c = controlled()
    const { run } = coalesce(c.task)

    run()
    run()
    run()
    run()
    expect(c.started()).toBe(1)

    await c.finish()
    expect(c.started()).toBe(2)

    await c.finish()
    expect(c.started()).toBe(2)
  })

  test('a failed run still lets the next one through', async () => {
    let calls = 0
    const { run } = coalesce(() => {
      calls++
      return Promise.reject(new Error('no'))
    })
    run()
    run()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toBe(2)
  })

  test('after stop nothing more runs', async () => {
    const c = controlled()
    const { run, stop } = coalesce(c.task)
    run()
    run()
    stop()
    await c.finish()
    run()
    expect(c.started()).toBe(1)
  })
})
