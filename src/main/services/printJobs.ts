import { SAVE_ERROR } from '@shared/saveErrors'

/**
 * Settles with `work`, or rejects once `ms` pass; `onExpire` then cleans up (destroys the print
 * window), so a stuck page never leaves a promise that never settles.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, onExpire: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onExpire()
      reject(new Error(`${SAVE_ERROR.printTimeout}: printing took longer than ${ms} ms`))
    }, ms)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

/** Runs jobs one after another, each starting when the one before has settled, failed or not. */
export function createQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job)
    tail = run.catch(() => undefined)
    return run
  }
}
