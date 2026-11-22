import { useEffect } from 'react'
import { fontsApi } from '../design/fontsApi.ts'

const prefix = 'ProjectFont-'

// 문서가 쓰는 프로젝트 글꼴을 내려받아 ProjectFont-{id} 이름으로 등록한다
// 못 불러온 글꼴은 기본 글꼴로 그린다
export function useProjectFonts(projectId: string, families: string[]) {
  const wanted = [...new Set(families.filter((family) => family.startsWith(prefix)))].sort().join('\n')

  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    const added: FontFace[] = []
    void fontsApi.list(projectId, controller.signal).then(async ({ items }) => {
      for (const family of wanted.split('\n')) {
        const font = items.find((item) => `${prefix}${item.id}` === family)
        if (!font) continue
        const face = await new FontFace(family, await fontsApi.content(projectId, font, controller.signal)).load()
        if (controller.signal.aborted) return
        document.fonts.add(face)
        added.push(face)
      }
    }).catch(() => undefined)
    return () => {
      controller.abort()
      for (const face of added) document.fonts.delete(face)
    }
  }, [projectId, wanted])
}
