import { useOutletContext } from 'react-router'

export type CurrentProject = { id: string; name: string } | null
export function useShell() {
  return useOutletContext<{ setCurrentProject: (project: CurrentProject) => void }>()
}
