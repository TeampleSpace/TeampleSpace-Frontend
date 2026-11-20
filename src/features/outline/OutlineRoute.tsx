import OutlinePage from './OutlinePage.tsx'
import OutlineEvidence from './OutlineEvidence.tsx'
import OutlineGeneration from '../outline-ai/OutlineGeneration.tsx'

export default function OutlineRoute() {
  return <OutlinePage renderEvidence={OutlineEvidence} renderAi={OutlineGeneration} designReady />
}
