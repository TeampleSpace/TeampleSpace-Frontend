import { useEffect, useRef } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import { Button } from '../../../shared/ui/Button.tsx'
import { limits } from '../../../entities/material/model.ts'
import styles from './Materials.module.css'

type Tool = { label: string; active: (editor: Editor) => boolean; run: (editor: Editor) => void }
const tools: Tool[] = [
  { label: '제목', active: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: '굵게', active: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: '목록', active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '링크', active: (e) => e.isActive('link'), run: (e) => {
    if (e.isActive('link')) { e.chain().focus().unsetLink().run(); return }
    const href = window.prompt('연결할 주소를 입력해 주세요', 'https://')?.trim()
    if (href) e.chain().focus().extendMarkRange('link').setLink({ href }).run()
  } },
  { label: '인용', active: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: '코드', active: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
]

// 쓰는 자리에서 서식이 바로 보이는 마크다운 편집기. 바깥에는 마크다운 문자열만 주고받는다
export function MarkdownEditor({ id, value, disabled, onChange }: {
  id: string; value: string; disabled?: boolean; onChange: (value: string) => void
}) {
  // 편집기에서 마지막으로 내보낸 값. 같은 값이 다시 들어오면 내용을 덮어쓰지 않는다
  const emitted = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  const editor = useEditor({
    extensions: [StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }), Markdown,
      Placeholder.configure({ placeholder: '쓰는 대로 서식이 바로 적용돼요. 샵과 공백을 입력하면 제목이 돼요', emptyNodeClass: 'isEmpty' })],
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    editorProps: {
      attributes: { id, class: styles.editorInput, role: 'textbox', 'aria-multiline': 'true', 'aria-label': '메모 내용' },
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
    if (!editor || value === emitted.current) return
    emitted.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])

  useEffect(() => { editor?.setEditable(!disabled) }, [editor, disabled])

  const active = useEditorState({ editor, selector: ({ editor }) => editor ? tools.map((tool) => tool.active(editor)) : [] })

  return <div className={styles.editor} data-disabled={disabled || undefined}>
    <div className={styles.editorTools} role="toolbar" aria-label="마크다운 서식">
      {tools.map((tool, index) => <Button key={tool.label} variant="text" disabled={disabled || !editor}
        aria-pressed={active?.[index] ?? false} onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor && tool.run(editor)}>{tool.label}</Button>)}
    </div>
    <EditorContent editor={editor} />
  </div>
}
