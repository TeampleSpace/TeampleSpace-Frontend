import { createContext, useContext } from 'react'
import type { AuthCapabilities, User } from './model.ts'

type Context = {
  user: User | null; capabilities: AuthCapabilities | null; loading: boolean; error: unknown
  refresh: () => Promise<User | null>; setUser: (user: User | null) => void
}
export const SessionContext = createContext<Context | null>(null)

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('세션 공급자가 필요합니다')
  return value
}
