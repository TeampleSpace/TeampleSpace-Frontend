import { expect, test } from 'vitest'
import { sharedPreview } from './sharedDocs.ts'

const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-xy'

test('구글 문서 주소를 미리보기 주소로 바꾼다', () => {
  expect(sharedPreview(`https://docs.google.com/document/d/${id}/edit?usp=sharing`))
    .toEqual({ src: `https://docs.google.com/document/d/${id}/preview`, label: '구글 문서' })
  expect(sharedPreview(`https://docs.google.com/spreadsheets/u/1/d/${id}/edit#gid=0`)?.src)
    .toBe(`https://docs.google.com/spreadsheets/d/${id}/preview`)
  expect(sharedPreview(`https://docs.google.com/presentation/d/${id}/view`)?.label).toBe('구글 프레젠테이션')
  expect(sharedPreview(`https://drive.google.com/file/d/${id}/view?usp=drive_link`)?.src)
    .toBe(`https://drive.google.com/file/d/${id}/preview`)
})

test('구글 문서가 아니거나 미리보기를 만들 수 없는 주소는 그대로 둔다', () => {
  expect(sharedPreview('https://example.com/document/d/1234567890abc/edit')).toBeNull()
  expect(sharedPreview(`http://docs.google.com/document/d/${id}/edit`)).toBeNull()
  expect(sharedPreview('https://docs.google.com/document/d/e/2PACX-1vQ/pub')).toBeNull()
  expect(sharedPreview('https://docs.google.com.evil.example/document/d/' + id)).toBeNull()
  expect(sharedPreview('주소 아님')).toBeNull()
})
