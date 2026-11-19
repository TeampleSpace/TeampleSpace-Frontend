import { lazy, Suspense } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { limits } from './model.ts'
import styles from './Materials.module.css'

const Markdown = lazy(() => import('./Markdown.tsx'))

type Tool = { label: string; before: string; after?: string; line?: boolean; sample: string }
const tools: Tool[] = [
  { label: '제목', before: '## ', line: true, sample: '제목' },
  { label: '굵게', before: '**', after: '**', sample: '굵게' },
  { label: '목록', before: '- ', line: true, sample: '항목' },
  { label: '링크', before: '[', after: '](https://)', sample: '텍스트' },
  { label: '인용', before: '> ', line: true, sample: '인용' },
  { label: '코드', before: '`', after: '`', sample: '코드' },
]

// 마크다운 작성과 미리보기. 미리보기로 바꿔도 입력란은 그대로 두어 커서를 잃지 않는다
export function MarkdownEditor({ id, value, mode, disabled, onChange, onModeChange }: {
  id: string; value: string; mode: 'write' | 'preview'; disabled?: boolean
  onChange: (value: string) => void; onModeChange: (mode: 'write' | 'preview') => void
}) {
  function insert(tool: Tool) {
    const area = document.getElementById(id) as HTMLTextAreaElement | null
    if (!area) return
    const { selectionStart: start, selectionEnd: end } = area
    const selected = value.slice(start, end) || tool.sample
    // 줄 단위 도구는 줄 맨 앞에 붙인다
    const at = tool.line ? value.lastIndexOf('\n', start - 1) + 1 : start
    const next = tool.line
      ? value.slice(0, at) + tool.before + value.slice(at)
      : value.slice(0, start) + tool.before + selected + (tool.after ?? '') + value.slice(end)
    onChange(next.slice(0, limits.markdown))
    const from = tool.line ? start + tool.before.length : start + tool.before.length
    const to = tool.line ? end + tool.before.length : from + selected.length
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(from, to) })
  }
  return <div className={styles.editor}>
    <div className={styles.editorModes} role="tablist" aria-label="편집 방식">
      <Button variant="text" role="tab" aria-selected={mode === 'write'} onClick={() => onModeChange('write')}>작성</Button>
      <Button variant="text" role="tab" aria-selected={mode === 'preview'} onClick={() => onModeChange('preview')}>미리보기</Button>
    </div>
    <div className={styles.editorTools} role="toolbar" aria-label="마크다운 서식" hidden={mode !== 'write'}>
      {tools.map((tool) => <Button key={tool.label} variant="text" disabled={disabled} onClick={() => insert(tool)}>{tool.label}</Button>)}
    </div>
    <textarea id={id} className={styles.editorInput} aria-label="메모 내용" hidden={mode !== 'write'} disabled={disabled}
      maxLength={limits.markdown} value={value} onChange={(event) => onChange(event.target.value)} />
    {mode === 'preview' && <div className={styles.editorPreview} aria-label="미리보기">
      {value.trim()
        ? <Suspense fallback={<p className={styles.plain}>{value}</p>}><Markdown>{value}</Markdown></Suspense>
        : <p className={styles.listNote}>미리 볼 내용이 없어요</p>}
    </div>}
  </div>
}
