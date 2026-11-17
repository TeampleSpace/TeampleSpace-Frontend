import { z } from 'zod'

// 백엔드 설계서의 공유 문서 형식을 옮겼다
// 필드 이름은 설계서를 따르고 미확정 표시가 있는 부분은 실험용 임시 형식이다

const version = z.number().int().min(1)

export const sourceRefSchema = z.object({
  materialId: z.string(),
  revisionId: z.string(),
  sourceVersion: z.number().int(),
  chunkId: z.string().optional(),
  page: z.number().int().optional(),
  excerpt: z.string().optional(),
  // 삭제된 자료 표시
  sourceDeleted: z.boolean().optional(),
})
export type SourceRef = z.infer<typeof sourceRefSchema>

// 좌표는 발표 캔버스 단위다
export const geometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  z: z.number(),
})
export type Geometry = z.infer<typeof geometrySchema>

const elementBase = {
  id: z.string(),
  slideId: z.string(),
  version,
  geometry: geometrySchema,
  sourceRefs: z.array(sourceRefSchema),
  deletedAt: z.string().optional(),
}

// 미확정. 텍스트 스타일 허용 목록
export const textElementSchema = z.object({
  ...elementBase,
  type: z.literal('text'),
  content: z.object({ text: z.string() }),
  style: z.object({
    fontFamily: z.string(),
    fontSize: z.number(),
    fontWeight: z.number(),
    color: z.string(),
    align: z.enum(['left', 'center', 'right']),
    lineHeight: z.number(),
  }),
})

// 미확정. 도형 종류와 속성
export const shapeElementSchema = z.object({
  ...elementBase,
  type: z.literal('shape'),
  content: z.object({ shape: z.enum(['rect', 'ellipse']) }),
  style: z.object({
    fill: z.string(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
  }),
})

// fileObjectId, crop, alt는 설계서 기준이다
// 미확정. crop 형식과 읽기 응답에 붙는 임시 주소 필드 이름
export const imageElementSchema = z.object({
  ...elementBase,
  type: z.literal('image'),
  content: z.object({
    fileObjectId: z.string(),
    alt: z.string(),
    crop: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .optional(),
    assetUrl: z.string().optional(),
  }),
  style: z.object({}),
})

export const elementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  shapeElementSchema,
  imageElementSchema,
])
export type Element = z.infer<typeof elementSchema>
export type TextElement = z.infer<typeof textElementSchema>

// 미확정. elements를 식별자 기준 객체로 둘지 배열로 둘지
export const slideSchema = z.object({
  id: z.string(),
  presentationId: z.string(),
  generation: version,
  version,
  layoutId: z.string(),
  elementIds: z.array(z.string()),
  elements: z.record(z.string(), elementSchema),
})
export type Slide = z.infer<typeof slideSchema>

// 미확정. 캔버스 단위와 slides를 식별자 기준 객체로 둘지 배열로 둘지
export const presentationSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    schemaVersion: z.number().int(),
    generation: version,
    version,
    orderVersion: version,
    canvas: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
      unit: z.string(),
    }),
    slideIds: z.array(z.string()),
    slides: z.record(z.string(), slideSchema),
  })
  .superRefine((doc, context) => {
    // 순서 목록과 본문이 서로 어긋나지 않는지 확인한다
    for (const slideId of doc.slideIds) {
      const slide = doc.slides[slideId]
      if (!slide) {
        context.addIssue({ code: 'custom', message: `슬라이드 없음 ${slideId}` })
        continue
      }
      for (const elementId of slide.elementIds) {
        if (slide.elements[elementId]?.slideId !== slideId) {
          context.addIssue({ code: 'custom', message: `요소 불일치 ${elementId}` })
        }
      }
    }
  })
export type Presentation = z.infer<typeof presentationSchema>

// 미확정. 요소 수정 요청의 patch 형식
export const elementPatchSchema = z.object({
  content: z.object({ text: z.string() }).optional(),
  geometry: geometrySchema.partial().optional(),
})
export type ElementPatch = z.infer<typeof elementPatchSchema>

// 요소 수정 요청. Idempotency-Key 헤더와 함께 보낸다
export const elementSaveRequestSchema = z.object({
  generation: version,
  baseVersion: version,
  editGroupId: z.string(),
  clientMutationId: z.string(),
  finalizeGroup: z.boolean().optional(),
  patch: elementPatchSchema.optional(),
})
export type ElementSaveRequest = z.infer<typeof elementSaveRequestSchema>

// 수정 응답과 실시간 이벤트가 함께 쓰는 결과 형식
export const elementSaveResultSchema = z.object({
  clientMutationId: z.string(),
  resource: elementSchema,
  elementVersion: version.optional(),
  slideVersion: version.optional(),
  presentationVersion: version.optional(),
  orderVersion: version.optional(),
  generation: version.optional(),
  changeId: z.string().optional(),
  eventId: z.string(),
})
export type ElementSaveResult = z.infer<typeof elementSaveResultSchema>

// 편집 화면 스냅샷. 문서와 이벤트 커서 외의 필드 이름은 미확정
export const editorSnapshotSchema = z.looseObject({
  scope: z.literal('editor'),
  presentation: presentationSchema,
  eventCursor: z.string(),
})
export type EditorSnapshot = z.infer<typeof editorSnapshotSchema>
