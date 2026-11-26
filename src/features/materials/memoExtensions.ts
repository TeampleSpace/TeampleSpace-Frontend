import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

export type CaretUser = { name: string; color: string }

// 다른 팀원의 커서. 이름표를 커서 위에 붙인다
function caret(user: Record<string, string>) {
  const cursor = document.createElement('span')
  cursor.setAttribute('style', `position: relative; margin: 0 -1px; border-left: 2px solid ${user.color}; pointer-events: none; word-break: normal;`)
  const label = document.createElement('span')
  label.setAttribute('style', `position: absolute; bottom: 100%; left: -2px; padding: 1px 6px; border-radius: 4px 4px 4px 0; background: ${user.color}; color: #fff; font-size: 11px; font-weight: 600; line-height: 16px; white-space: nowrap; user-select: none;`)
  label.textContent = user.name
  cursor.append(label)
  return cursor
}

// 메모 편집기의 확장. 공유 문서가 있으면 내용과 되돌리기를 공유 문서가 맡고, 커서 상태가 있으면 팀원 커서를 그린다
export function memoExtensions(doc?: Y.Doc, cursors?: { awareness: Awareness; user: CaretUser }) {
  return [StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true }, ...(doc ? { undoRedo: false } : {}) }), Markdown,
    Placeholder.configure({ placeholder: '쓰는 대로 서식이 바로 적용돼요. 샵과 공백을 입력하면 제목이 돼요', emptyNodeClass: 'isEmpty' }),
    ...(doc ? [Collaboration.configure({ document: doc })] : []),
    ...(doc && cursors ? [CollaborationCaret.configure({
      provider: { awareness: cursors.awareness }, user: cursors.user, render: caret,
      selectionRender: (user: Record<string, string>) => ({ nodeName: 'span', style: `background-color: ${user.color}33`, 'data-user': user.name }),
    })] : [])]
}
