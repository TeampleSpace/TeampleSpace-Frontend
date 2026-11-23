// 테스트에서 저장과 충돌 흐름만 확인하려고 편집기를 입력란으로 바꾼 대역. 실제 편집기는 MarkdownEditor.test.tsx에서 확인한다
export function MarkdownEditor({ id, value, disabled, onChange }: {
  id: string; value: string; disabled?: boolean; onChange: (value: string) => void
}) {
  return <textarea id={id} aria-label="메모 내용" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
}
