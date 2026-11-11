import { describe, expect, test } from 'vitest'
import { SAVE_ERROR } from '@shared/saveErrors'
import { createQueue, withDeadline } from './printJobs'

const later = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const never = (): Promise<never> => new Promise(() => undefined)

describe('withDeadline', () => {
  test('gives the result when the work is done in time', async () => {
    let expired = false
    await expect(withDeadline(later(5, 'pdf'), 200, () => (expired = true))).resolves.toBe('pdf')
    expect(expired).toBe(false)
  })

  test('a page that never answers ends at the limit, cleaned up, with the timeout code', async () => {
    let expired = false
    const result = withDeadline(never(), 30, () => (expired = true))

    await expect(result).rejects.toThrow(SAVE_ERROR.printTimeout)
    expect(expired).toBe(true)
  })

  test('a failure before the limit comes through as it is', async () => {
    await expect(withDeadline(Promise.reject(new Error(`${SAVE_ERROR.printFailed}: gone`)), 200, () => undefined)).rejects.toThrow(
      SAVE_ERROR.printFailed,
    )
  })
})

describe('createQueue', () => {
  test('runs one job at a time, in order, and a failed job does not stop the next', async () => {
    const queue = createQueue()
    let running = 0
    let most = 0
    const order: string[] = []
    const job = (name: string, fail = false) => async (): Promise<string> => {
      running++
      most = Math.max(most, running)
      await later(10, null)
      order.push(name)
      running--
      if (fail) throw new Error(name)
      return name
    }

    const results = await Promise.allSettled([queue(job('a')), queue(job('b', true)), queue(job('c'))])

    expect(most).toBe(1)
    expect(order).toEqual(['a', 'b', 'c'])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })
})
