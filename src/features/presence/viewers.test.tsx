// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { colorOf, tabOf } from './viewers.ts'
import { ProjectViewers } from './ProjectViewers.tsx'

describe('프로젝트 탭 접속 현황', () => {
  it('주소로 보는 탭을 정한다', () => {
    expect(tabOf('/projects/p1')).toBe('overview')
    expect(tabOf('/projects/p1/materials')).toBe('materials')
    expect(tabOf('/projects/p1/slides/s1')).toBe('slides')
    expect(tabOf('/projects/p1/unknown')).toBeUndefined()
    expect(tabOf('/account')).toBeUndefined()
  })

  it('팀원 이름과 보는 탭을 같은 색으로 보여 준다', () => {
    render(<ProjectViewers viewers={[{ userId: 'u1', name: '김팀원', tab: 'outline' }]} />)
    const list = screen.getByRole('list', { name: '지금 함께 보는 팀원' })
    expect(list.textContent).toContain('김팀원')
    expect(list.textContent).toContain('발표 구성 보는 중')
    expect(colorOf('u1')).toBe(colorOf('u1'))
  })
})
