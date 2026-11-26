import { useEffect, useRef, useState } from 'react'
import { Editor } from '@tiptap/react'
import type * as Y from 'yjs'
import { memoExtensions } from '../memoExtensions.ts'

// 테스트에서 저장 흐름만 확인하려고 편집기를 입력란으로 바꾼 대역. 실제 편집기는 MarkdownEditor.test.tsx에서 확인한다
// 공유 문서를 받으면 그 내용을 마크다운으로 보여 주고, 입력은 공유 문서에 쓴다. 실제 편집기처럼 팀원의 변경도 바깥에 알린다
export function MarkdownEditor({ id, value, disabled, onChange, doc }: {
  id: string; value: string; disabled?: boolean; onChange: (value: string) => void; doc?: Y.Doc
}) {
  const [shared, setShared] = useState('')
  const editor = useRef<Editor>(undefined)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  useEffect(() => {
    if (!doc) return
    const current = new Editor({ extensions: memoExtensions(doc) })
    editor.current = current
    const read = () => current.getMarkdown().replace(/\n+$/, '')
    setShared(read())
    current.on('update', () => { const next = read(); setShared(next); onChangeRef.current(next) })
    return () => current.destroy()
  }, [doc])
  return <textarea id={id} aria-label="메모 내용" value={doc ? shared : value} disabled={disabled}
    onChange={(event) => {
      if (editor.current) editor.current.commands.setContent(event.target.value, { contentType: 'markdown' })
      else onChange(event.target.value)
    }} />
}
