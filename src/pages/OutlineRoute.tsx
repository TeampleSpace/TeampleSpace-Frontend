import OutlinePage from '../features/outline/ui/OutlinePage.tsx'
import type { OutlineEvidenceProps } from '../features/outline/ui/OutlinePage.tsx'
import OutlineEvidence from '../features/outline/ui/OutlineEvidence.tsx'
import OutlineGeneration from '../features/outline-ai/ui/OutlineGeneration.tsx'
import { SourceViewer } from '../features/materials/ui/SourceViewer.tsx'

// 근거 화면에 자료 기능의 원문 보기를 연결한다
function Evidence(props: OutlineEvidenceProps) {
  return <OutlineEvidence {...props} sourceViewer={SourceViewer} />
}

export default function OutlineRoute() {
  return <OutlinePage renderEvidence={Evidence} renderAi={OutlineGeneration} designReady />
}
