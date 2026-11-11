/** FNV-1a, 32 bits: the same text always gives the same number. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** A short stable key for a piece of text: its trimmed form hashed, as 8 hex digits. */
export const textKey = (text: string): string => fnv1a(text.trim()).toString(16).padStart(8, '0')
