// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { JobProgress } from './JobProgress.tsx'
import type { Job } from './model.ts'

afterEach(cleanup)

const job = { id: 'job-1', status: 'queued', progress: 0 } as Job

test('대기 중에는 진행률 없이 움직이는 막대와 대기 상태만 보여 준다', () => {
  render(<JobProgress job={job} label="진행률" />)
  expect(screen.getByRole('status').textContent).toBe('생성 순서를 기다리고 있어요')
  expect(screen.getByRole('progressbar', { name: '진행률' }).hasAttribute('value')).toBe(false)
})

test('진행 중 숫자는 상태 알림 영역 밖에 보여 준다', () => {
  render(<JobProgress job={{ ...job, status: 'running', progress: 40 }} label="진행률" />)
  expect(screen.getByRole('status').textContent).toBe('생성하고 있어요')
  expect(screen.getByText('40%')).toBeTruthy()
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('40')
})
