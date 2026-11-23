// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MarkdownEditor } from './MarkdownEditor.tsx'

afterEach(cleanup)

test('마크다운을 서식이 적용된 모습으로 보여 주고 서식 도구로 바꾼 결과를 마크다운으로 내보낸다', async () => {
  const onChange = vi.fn()
  const { rerender } = render(<MarkdownEditor id="memo" value={'## 설문 결과\n\n**반납함**이 멀다'} onChange={onChange} />)
  const body = await screen.findByRole('textbox', { name: '메모 내용' })
  await waitFor(() => expect(body.querySelector('h2')?.textContent).toBe('설문 결과'))
  expect(body.querySelector('strong')?.textContent).toBe('반납함')

  // 제목 줄에 커서를 두면 제목 도구가 눌린 상태로 보인다
  fireEvent.focus(body)
  const heading = screen.getByRole('button', { name: '제목' })
  await waitFor(() => expect(heading.getAttribute('aria-pressed')).toBe('true'))

  // 제목을 풀면 마크다운의 샵이 빠진다
  fireEvent.click(heading)
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('설문 결과\n\n**반납함**이 멀다'))

  // 바깥에서 값이 바뀌면 편집기 내용도 바뀐다
  rerender(<MarkdownEditor id="memo" value="> 다른 팀원이 고친 내용" onChange={onChange} />)
  await waitFor(() => expect(body.querySelector('blockquote')?.textContent).toBe('다른 팀원이 고친 내용'))

  // 막아 두면 고칠 수 없고 서식 도구도 꺼진다
  rerender(<MarkdownEditor id="memo" value="> 다른 팀원이 고친 내용" disabled onChange={onChange} />)
  await waitFor(() => expect(body.getAttribute('contenteditable')).toBe('false'))
  expect(screen.getByRole('button', { name: '굵게' })).toHaveProperty('disabled', true)
})
