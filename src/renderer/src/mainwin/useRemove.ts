import { useCallback } from 'react'
import type { Item } from '@shared/types'
import { useToast } from './Toast'

/** Deletes right away and offers a one-minute undo instead of asking first. */
export function useRemove(): (item: Pick<Item, 'id' | 'title'>) => void {
  const show = useToast()
  return useCallback(
    (item) => {
      const undo = (): Promise<void> =>
        window.api.undoRemove(item.id).then((ok) => {
          if (!ok) throw new Error('Undo window passed')
        })
      window.api
        .remove(item.id)
        .then(() => show(`已刪除「${item.title}」`, undo))
        .catch(() => show('沒有刪成功，再試一次看看'))
    },
    [show],
  )
}

/** "不做了" with the same one-click way back. */
export function useDrop(): (item: Pick<Item, 'id' | 'title'>) => void {
  const show = useToast()
  return useCallback(
    (item) => {
      window.api
        .drop(item.id)
        .then(() => show(`放下了「${item.title}」`, () => window.api.reopen(item.id)))
        .catch(() => show('沒有成功，再試一次看看'))
    },
    [show],
  )
}
