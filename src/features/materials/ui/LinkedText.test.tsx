// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LinkedText } from './LinkedText.tsx'

afterEach(cleanup)

test('본문 속 주소를 새 탭 링크로 바꾸고 문장부호와 괄호는 링크에 넣지 않는다', () => {
  render(<p><LinkedText text={'반납 안내 (https://example.com/guide)를 보세요. 문의 mailto:team@example.com, 자세히는 https://example.com/a?b=1.'} /></p>)
  const links = screen.getAllByRole('link')
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://example.com/guide', 'mailto:team@example.com', 'https://example.com/a?b=1'])
  expect(links.every((link) => link.getAttribute('target') === '_blank' && link.getAttribute('rel') === 'noopener noreferrer')).toBe(true)
  expect(screen.getByText(/를 보세요\. 문의/)).toBeTruthy()
})

test('위험한 주소와 주소가 없는 글자는 링크로 만들지 않는다', () => {
  render(<p><LinkedText text={'javascript:alert(1) 그리고 file:///etc/passwd 는 글자로 둔다'} /></p>)
  expect(screen.queryAllByRole('link')).toHaveLength(0)
})
