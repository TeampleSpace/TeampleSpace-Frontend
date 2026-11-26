import { z } from 'zod'
import type { ApiClient } from '../../shared/api/client.ts'
import { api } from '../session/api.ts'
import { jobSchema } from './model.ts'

// 백엔드 계약 stage-2.schema.json의 MaterialResearchResult
export const researchResultSchema = z.object({
  type: z.literal('material_research'),
  topic: z.string().min(1).max(200),
  markdown: z.string().min(1).max(8000),
  sources: z.array(z.object({ title: z.string().min(1).max(200), url: z.string().regex(/^https?:\/\//).max(2000) })).min(1).max(10),
})
export type ResearchResult = z.infer<typeof researchResultSchema>
export const topicMax = 200

export function createResearchApi(client: ApiClient) {
  return {
    // 응답을 받지 못하면 같은 키와 주제로 다시 보낸다
    start: (projectId: string, topic: string, key: string) =>
      client.request(`/projects/${encodeURIComponent(projectId)}/research-jobs`, jobSchema, {
        method: 'POST', body: { topic }, idempotencyKey: key, timeoutMs: 15000,
      }),
  }
}
export const researchApi = createResearchApi(api)

// 자료로 저장할 메모 본문. 출처 목록과 AI 정리 표시를 함께 남긴다
export function researchMarkdown(result: ResearchResult) {
  const label = (text: string) => text.replace(/[[\]\\]/g, '\\$&')
  const sources = result.sources.map((source, index) => `${index + 1}. [${label(source.title)}](<${source.url}>)`)
  return `> AI 자료 조사로 정리한 내용이에요. 출처에서 사실을 확인해 주세요.\n\n${result.markdown}\n\n## 출처\n\n${sources.join('\n')}\n`
}
