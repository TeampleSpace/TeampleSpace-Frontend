import { createApiClient } from '../../shared/api/client.ts'
import type { ApiClient } from '../../shared/api/client.ts'
import { authCapabilitiesSchema, challengeSchema, deletionSchema, emptySchema, loginSchema, reauthSchema, userSchema } from './model.ts'

export const api = createApiClient()

export function createAuthApi(client: ApiClient) {
  return {
    capabilities: () => client.request('/capabilities', authCapabilitiesSchema, { timeoutMs: 10000 }),
    me: () => client.request('/me', userSchema, { timeoutMs: 10000 }),
    challenge: (email: string, purpose: 'login' | 'reauth') => client.request('/auth/challenges', challengeSchema, {
      method: 'POST', body: { email, purpose }, timeoutMs: 15000,
    }),
    login: (challengeId: string, code: string) => client.request('/auth/sessions', loginSchema, {
      method: 'POST', body: { challengeId, code }, timeoutMs: 15000,
    }),
    update: (name: string, version: number, consentVersions?: Record<string, string>) => client.request('/me', userSchema, {
      method: 'PATCH', body: { name, version, ...(consentVersions ? { consentVersions } : {}) }, timeoutMs: 15000,
    }),
    logout: () => client.request('/auth/session', emptySchema, { method: 'DELETE', timeoutMs: 10000 }),
    reauthenticate: (challengeId: string, code: string) => client.request('/auth/reauthentications', reauthSchema, {
      method: 'POST', body: { challengeId, code }, timeoutMs: 15000,
    }),
    deleteAccount: (reauthProof: string) => client.request('/me', deletionSchema, {
        method: 'DELETE', body: { reauthProof, confirmationText: '탈퇴' }, timeoutMs: 15000,
      }),
  }
}
export const authApi = createAuthApi(api)
