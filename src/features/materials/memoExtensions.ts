import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import Collaboration from '@tiptap/extension-collaboration'
import type * as Y from 'yjs'

// 메모 편집기의 확장. 공유 문서가 있으면 내용과 되돌리기를 공유 문서가 맡는다
export function memoExtensions(doc?: Y.Doc) {
  return [StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true }, ...(doc ? { undoRedo: false } : {}) }), Markdown,
    Placeholder.configure({ placeholder: '쓰는 대로 서식이 바로 적용돼요. 샵과 공백을 입력하면 제목이 돼요', emptyNodeClass: 'isEmpty' }),
    ...(doc ? [Collaboration.configure({ document: doc })] : [])]
}
