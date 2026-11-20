import { expect, test } from 'vitest'
import { invitationToken, memberPermissions } from './model.ts'
import type { Member, Project } from './model.ts'

const project: Project = { id: 'p', name: '팀 과제', topic: null, presentationConstraints: null,
  ownerId: 'owner', version: 1, memberCount: 2, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' }
const owner: Member = { userId: 'owner', name: '소유자', role: 'owner', isOwner: true, membershipVersion: 1 }
const member: Member = { userId: 'member', name: '팀원', role: 'member', isOwner: false, membershipVersion: 1 }

test('팀원에게 소유자 관리 동작을 노출하지 않는다', () => {
  expect(memberPermissions(project, owner, 'member')).toEqual({ canRemove: false, canTransfer: false, canLeave: false })
  expect(memberPermissions(project, member, 'member')).toEqual({ canRemove: false, canTransfer: false, canLeave: true })
  expect(memberPermissions(project, member, 'owner')).toEqual({ canRemove: true, canTransfer: true, canLeave: false })
  expect(memberPermissions(project, owner, 'owner')).toEqual({ canRemove: false, canTransfer: false, canLeave: false })
})

test('외부 호스트와 조작된 초대 경로를 거절한다', () => {
  const origin = 'https://teamplespace.example'
  const token = 'valid-invitation-token-1234'
  expect(invitationToken(`${origin}/invite/${token}`, origin)).toBe(token)
  expect(invitationToken(`/invite/${token}`, origin)).toBe(token)
  for (const input of [`https://evil.example/invite/${token}`, `//evil.example/invite/${token}`,
    `${origin}/invite/${token}?redirect=bad`, `${origin}/invite/${token}#bad`, '/invite/short', 'javascript:alert(1)']) {
    expect(invitationToken(input, origin)).toBeNull()
  }
})
