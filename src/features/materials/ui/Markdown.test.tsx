// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import Markdown from './Markdown.tsx'

test('메모 본문 링크는 새 탭 안내와 마크다운 제목을 함께 가진다', () => {
  render(<Markdown>{'[조사표](https://example.com/form "설문 원본")'}</Markdown>)
  const link = screen.getByRole('link', { name: /^조사표 ?\(새 탭에서 열림\)$/ })
  expect([link.getAttribute('href'), link.getAttribute('title'), link.getAttribute('target')])
    .toEqual(['https://example.com/form', '설문 원본', '_blank'])
})
