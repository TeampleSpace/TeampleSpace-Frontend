import { Fragment, useEffect, useRef } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { memoExtensions } from '../memoExtensions.ts'
import type { CaretUser } from '../memoExtensions.ts'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { Button } from '../../../shared/ui/Button.tsx'
import { limits } from '../../../entities/material/model.ts'
import styles from './Materials.module.css'
import memo from './Memo.module.css'

// group이 바뀌는 자리에 구분선을 둔다
type Tool = { label: string; group: number; active: (editor: Editor) => boolean; run: (editor: Editor) => void }
const tools: Tool[] = [
  { label: '제목', group: 0, active: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: '굵게', group: 1, active: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: '기울임', group: 1, active: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: '목록', group: 2, active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '번호 목록', group: 2, active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: '링크', group: 3, active: (e) => e.isActive('link'), run: (e) => {
    if (e.isActive('link')) { e.chain().focus().unsetLink().run(); return }
    const href = window.prompt('연결할 주소를 입력해 주세요', 'https://')?.trim()
    if (href) e.chain().focus().extendMarkRange('link').setLink({ href }).run()
  } },
  { label: '인용', group: 3, active: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: '코드', group: 3, active: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
]

// 쓰는 자리에서 서식이 바로 보이는 마크다운 편집기. 바깥에는 마크다운 문자열만 주고받는다
// doc을 주면 여러 명이 함께 고치는 공유 문서를 보여 주고 value는 쓰지 않는다. page면 회색 바탕 위 종이 모양으로 그린다
export function MarkdownEditor({ id, value, disabled, onChange, doc, cursors, page }: {
  id: string; value: string; disabled?: boolean; onChange: (value: string) => void; doc?: Y.Doc
  cursors?: { awareness: Awareness; user: CaretUser }; page?: boolean
}) {
  // 편집기에서 마지막으로 내보낸 값. 같은 값이 다시 들어오면 내용을 덮어쓰지 않는다
  const emitted = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  const editor = useEditor({
    extensions: memoExtensions(doc, cursors),
    ...(doc ? {} : { content: value, contentType: 'markdown' as const }),
    editable: !disabled,
    editorProps: {
      attributes: { id, class: page ? `${styles.editorInput} ${memo.paper}` : styles.editorInput, role: 'textbox', 'aria-multiline': 'true', 'aria-label': '메모 내용' },
    },
    onUpdate: ({ editor }) => {
      const next = editor.getMarkdown()
      // ponytail: 길이 제한은 넘친 입력을 되돌리는 방식이다. 붙여넣기 한 번에 크게 넘치면 그 입력 전체가 취소된다
      if (next.length > limits.markdown) { editor.commands.undo(); return }
      emitted.current = next
      onChangeRef.current(next)
    },
  })

  // 충돌 해결이나 다른 팀원의 저장으로 값이 바뀌면 편집기 내용을 맞춘다
  useEffect(() => {
    if (!editor || doc || value === emitted.current) return
    emitted.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value, doc])

  useEffect(() => { editor?.setEditable(!disabled) }, [editor, disabled])

  const active = useEditorState({ editor, selector: ({ editor }) => editor ? tools.map((tool) => tool.active(editor)) : [] })

  return <div className={page ? undefined : styles.editor} data-disabled={disabled || undefined}>
    <div className={page ? memo.tools : styles.editorTools} role="toolbar" aria-label="마크다운 서식">
      {tools.map((tool, index) => <Fragment key={tool.label}>
        {page && index > 0 && tools[index - 1].group !== tool.group && <span className={memo.divider} aria-hidden="true" />}
        <Button variant="text" disabled={disabled || !editor}
          aria-pressed={active?.[index] ?? false} onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor && tool.run(editor)}>{tool.label}</Button>
      </Fragment>)}
    </div>
    {page
      // 종이 바깥 여백을 눌러도 본문 끝에서 이어 쓴다
      ? <div className={memo.canvas} onMouseDown={(event) => {
        if (!editor || editor.view.dom.contains(event.target as Node)) return
        event.preventDefault(); editor.commands.focus('end')
      }}><EditorContent editor={editor} /></div>
      : <EditorContent editor={editor} />}
  </div>
}
