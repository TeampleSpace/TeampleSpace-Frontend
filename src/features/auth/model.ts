import { z } from 'zod'
import { capabilitiesSchema } from '../../shared/api/contract.ts'

export const providerSchema = z.enum(['email', 'kakao', 'naver', 'google'])
export type Provider = z.infer<typeof providerSchema>
export const providerNames: Record<Provider, string> = {
  email: '이메일', kakao: '카카오', naver: '네이버', google: 'Google',
}

export const userSchema = z.object({
  id: z.string(), name: z.string(), email: z.string().nullable(),
  consentVersions: z.record(z.string(), z.string()),
  ownedProjectCount: z.number().int().nonnegative(),
  onboardingStatus: z.enum(['pending', 'completed']),
  identities: z.array(z.object({
    provider: providerSchema, maskedEmail: z.string().nullable().optional(), linkedAt: z.string(),
  })),
  version: z.number().int().positive(),
})
export type User = z.infer<typeof userSchema>
export const authCapabilitiesSchema = capabilitiesSchema.extend({
  authProviders: z.array(z.object({ provider: providerSchema, enabled: z.boolean() })),
})
export type AuthCapabilities = z.infer<typeof authCapabilitiesSchema>
export const challengeSchema = z.object({ challengeId: z.string(), expiresAt: z.string(), retryAfter: z.number().nonnegative() })
export type Challenge = z.infer<typeof challengeSchema>
export const loginSchema = z.object({ user: userSchema, needsOnboarding: z.boolean() })
export const reauthSchema = z.object({ reauthProof: z.string(), expiresAt: z.string() })
export const deletionSchema = z.object({ deletionRequestId: z.string(), status: z.literal('completed') })
export const emptySchema = z.undefined()

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || [...value].some((character) => character.charCodeAt(0) < 32)) return '/'
  try {
    const url = new URL(value, 'https://teamplespace.invalid')
    if (url.origin !== 'https://teamplespace.invalid') return '/'
    if (!/^\/(?:$|projects(?:\/|$)|invite\/|account$)/.test(url.pathname)) return '/'
    return url.pathname + url.search + url.hash
  } catch { return '/' }
}

export function requiredDocuments(capabilities: AuthCapabilities | null) {
  const documents = ['terms', 'privacy'].map((type) => capabilities?.legalDocuments.find((doc) => doc.type === type))
  return documents.every((doc) => doc?.version && /^https?:\/\//.test(doc.url))
    ? documents as NonNullable<typeof documents[number]>[] : []
}

export function oauthUrl(provider: Provider, purpose: 'login' | 'reauth', returnTo: string) {
  return `/v1/auth/oauth/${provider}/authorize?${new URLSearchParams({ purpose, returnTo: safeReturnTo(returnTo) })}`
}
