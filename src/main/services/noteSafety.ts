/**
 * Replies and prompts go into a vault word for word, where Obsidian renders them and plugins may
 * run them. Before they do: a code fence left open is closed (else it swallows the rest of the
 * note); outside fences and inline code, images, embeds and HTML tags are escaped, so they read
 * the same but are not live; a fence's language outside a short list of plain programming and
 * config languages becomes `text` (a plugin can run `dataviewjs` and similar blocks).
 */

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const IMAGE_OR_EMBED = /(?<!\\)!\[/g
const HTML_TAG = /(?<!\\)<(?=[A-Za-z/!?])/g

const PLAIN_LANGUAGES: ReadonlySet<string> = new Set([
  'text', 'txt', 'plain', 'plaintext', 'log', 'console', 'output',
  'bash', 'sh', 'shell', 'zsh', 'fish', 'powershell', 'ps1', 'pwsh', 'cmd', 'bat', 'batch',
  'python', 'py', 'javascript', 'js', 'mjs', 'cjs', 'typescript', 'ts', 'tsx', 'jsx',
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'xml', 'csv', 'tsv',
  'html', 'css', 'scss', 'less', 'sql', 'graphql', 'proto',
  'go', 'rust', 'rs', 'java', 'kotlin', 'kt', 'c', 'h', 'cpp', 'c++', 'hpp', 'cs', 'csharp',
  'ruby', 'rb', 'php', 'swift', 'lua', 'r', 'dart', 'scala',
  'diff', 'patch', 'markdown', 'md', 'dockerfile', 'makefile', 'cmake', 'nginx', 'vue', 'svelte',
])

/** Escapes images, embeds and HTML tags in text that is not code. */
const escapeLive = (text: string): string => text.replace(IMAGE_OR_EMBED, '\\![').replace(HTML_TAG, '\\<')

/** One line made safe: escaped outside inline code spans; an unclosed backtick hides nothing. */
export function safeInline(line: string): string {
  const parts = line.split('`')
  // With an odd number of backticks the last one opens nothing, so the text after it is plain text.
  const lastPlain = parts.length % 2 === 0 ? parts.length - 1 : -1
  return parts.map((part, i) => (i % 2 === 0 || i === lastPlain ? escapeLive(part) : part)).join('`')
}

function safeFenceInfo(info: string): string {
  const language = info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return language === '' || PLAIN_LANGUAGES.has(language) ? info : 'text'
}

/** A reply or prompt made safe to quote in a note; ordinary Markdown comes through unchanged. */
export function safeQuote(text: string): string {
  const out: string[] = []
  let open: { readonly char: string; readonly size: number } | null = null
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const fence = FENCE.exec(line)
    if (open) {
      if (fence && fence[2][0] === open.char && fence[2].length >= open.size && fence[3].trim() === '') open = null
      out.push(line)
    } else if (fence) {
      open = { char: fence[2][0], size: fence[2].length }
      out.push(`${fence[1]}${fence[2]}${safeFenceInfo(fence[3])}`)
    } else {
      out.push(safeInline(line))
    }
  }
  if (open) out.push(open.char.repeat(open.size))
  return out.join('\n')
}
