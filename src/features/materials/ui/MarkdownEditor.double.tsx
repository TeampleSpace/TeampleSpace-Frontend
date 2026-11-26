import { useEffect, useRef, useState } from 'react'
import { Editor } from '@tiptap/react'
import type * as Y from 'yjs'
import { memoExtensions } from '../memoExtensions.ts'

// 테스트에서 저장 흐름만 확인하려고 편집기를 입력란으로 바꾼 대역. 실제 편집기는 MarkdownEditor.test.tsx에서 확인한다
// 공유 문서를 받으면 그 내용을 마크다운으로 보여 주고 입력도 공유 문서에 쓴다
export function MarkdownEditor({ id, value, disabled, onChange, doc }: {
  id: string; value: string; disabled?: boolean; onChange: (value: string) => void; doc?: Y.Doc
}) {
  const [shared, setShared] = useState('')
  const [typed, setTyped] = useState<string>()
  const editor = useRef<Editor>(undefined)
  useEffect(() => {
    if (!doc) return
    const current = new Editor({ extensions: memoExtensions(doc) })
    editor.current = current
    const read = () => setShared(current.getMarkdown().replace(/\n+$/, ''))
    read()
    current.on('update', read)
    return () => current.destroy()
  }, [doc])
  return <textarea id={id} aria-label="메모 내용" value={doc ? typed ?? shared : value} disabled={disabled}
    onChange={(event) => {
      const next = event.target.value
      setTyped(next)
      editor.current?.commands.setContent(next, { contentType: 'markdown' })
      onChange(next)
    }} />
}
