// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Button } from './Button.tsx'

afterEach(cleanup)

test('진행 중에도 버튼 이름을 유지하고 중복 실행을 막는다', () => {
  const onClick = vi.fn()
  render(<Button loading onClick={onClick}>저장</Button>)
  const button = screen.getByRole('button', { name: '저장' })
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})
