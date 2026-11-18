import { z } from 'zod'

export const projectSchema = z.object({
  id: z.string(), name: z.string(), topic: z.string().nullable(), presentationConstraints: z.string().nullable(),
  ownerId: z.string(), version: z.number().int().positive(), memberCount: z.number().int().nonnegative(),
  createdAt: z.string(), updatedAt: z.string(),
})
export type Project = z.infer<typeof projectSchema>
export type ProjectInput = { name: string; topic?: string; presentationConstraints?: string }
export const projectListSchema = z.object({ items: z.array(projectSchema), nextCursor: z.string().nullable() })
export const memberSchema = z.object({ userId: z.string(), name: z.string(), role: z.enum(['owner', 'member']), membershipVersion: z.number().int().positive(), isOwner: z.boolean() })
export type Member = z.infer<typeof memberSchema>
export const memberListSchema = z.object({ items: z.array(memberSchema), nextCursor: z.string().nullable() })
export const invitationSchema = z.object({ projectName: z.string(), inviterName: z.string(), expiresAt: z.string(), alreadyMember: z.boolean() })
export const invitationLinkSchema = z.object({ url: z.string().url(), expiresAt: z.string() })
export const acceptSchema = z.object({ projectId: z.string(), alreadyMember: z.boolean() })
export const removalSchema = z.object({
  clientMutationId: z.string(), tombstone: z.object({ type: z.literal('membership'), id: z.string(), deleted: z.literal(true) }),
  membershipVersion: z.number().int().positive(), eventId: z.string(),
})

export function invitationToken(value: string, origin: string): string | null {
  try {
    const url = new URL(value.trim(), origin)
    if (url.origin !== origin || url.search || url.hash) return null
    return /^\/invite\/([A-Za-z0-9_-]{16,256})\/?$/.exec(url.pathname)?.[1] ?? null
  } catch { return null }
}

export function memberPermissions(project: Project, member: Member, userId: string) {
  return {
    canRemove: project.ownerId === userId && member.userId !== userId && !member.isOwner,
    canTransfer: project.ownerId === userId && member.userId !== userId && !member.isOwner,
    canLeave: member.userId === userId && project.ownerId !== userId,
  }
}
