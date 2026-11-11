import { parseMarkdown, type CellAlign, type InlinePart, type MarkdownBlock } from '@shared/markdown'
import './markdown.css'

function Inline({ parts }: { parts: readonly InlinePart[] }): React.JSX.Element {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'bold' ? <strong key={i}>{p.text}</strong> : p.kind === 'code' ? <code key={i} className="md-c">{p.text}</code> : p.text,
      )}
    </>
  )
}

const alignStyle = (a: CellAlign): React.CSSProperties | undefined => (a ? { textAlign: a } : undefined)

/** A real table; its wrapper scrolls sideways when the table is wider than the card. */
function Table({ block }: { block: Extract<MarkdownBlock, { kind: 'table' }> }): React.JSX.Element {
  return (
    <div className="md-table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {block.header.map((cell, k) => (
              <th key={k} style={alignStyle(block.align[k])}>
                <Inline parts={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, k) => (
                <td key={k} style={alignStyle(block.align[k])}>
                  <Inline parts={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Block({ block }: { block: MarkdownBlock }): React.JSX.Element {
  switch (block.kind) {
    case 'heading':
      return (
        <div className="md-h">
          <Inline parts={block.parts} />
        </div>
      )
    case 'item':
      return (
        <div className="md-li" style={{ paddingLeft: `${block.depth * 1.4}em` }}>
          <span className="md-mark">{block.marker}</span>
          <span>
            <Inline parts={block.parts} />
          </span>
        </div>
      )
    case 'table':
      return <Table block={block} />
    case 'code':
      return (
        <pre className="md-code" tabIndex={0}>
          {block.text}
        </pre>
      )
    case 'line':
      return (
        <div className="md-p">
          <Inline parts={block.parts} />
        </div>
      )
    case 'gap':
      return <div className="md-gap" aria-hidden="true" />
  }
}

/** An agent's reply as readable text: headings, lists, tables, bold and code shown as such, the rest as written. */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="mdv">
      {parseMarkdown(text).map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  )
}
