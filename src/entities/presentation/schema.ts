import { z } from 'zod'

// 백엔드 저장소의 공통 계약을 옮긴 문서 형식이다
// 기준은 contracts/schemas/document.schema.json과 api.schema.json이며 형식을 따로 만들지 않는다
// 계약 예제가 이 형식을 통과하는지는 contracts.test.ts에서 확인한다

const version = z.number().int().min(1)
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

export const sourceRefSchema = z.object({
  materialId: z.string(),
  revisionId: z.string(),
  sourceVersion: version,
  chunkId: z.string().optional(),
  page: z.number().int().min(1).optional(),
  excerpt: z.string().optional(),
  // 삭제된 자료 표시
  sourceDeleted: z.boolean().optional(),
})
export type SourceRef = z.infer<typeof sourceRefSchema>

// 캔버스 단위 좌표. rotation은 도 단위, z는 쌓임 순서다
export const geometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number(),
  z: z.number().int(),
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

export const textElementSchema = z.object({
  ...elementBase,
  type: z.literal('text'),
  // 줄바꿈은 개행 문자로 표현한다
  content: z.object({ text: z.string() }),
  style: z.object({
    fontFamily: z.string().min(1),
    fontSize: z.number().positive(),
    fontWeight: z.number(),
    color,
    align: z.enum(['left', 'center', 'right']),
    // 글자 크기에 대한 배수
    lineHeight: z.number().positive(),
  }),
})

export const shapeElementSchema = z.object({
  ...elementBase,
  type: z.literal('shape'),
  content: z.object({ shape: z.enum(['rect', 'ellipse']) }),
  style: z.object({
    fill: color.nullable(),
    stroke: color.nullable(),
    strokeWidth: z.number().min(0),
    cornerRadius: z.number().min(0).optional(),
  }),
})

export const imageElementSchema = z.object({
  ...elementBase,
  type: z.literal('image'),
  content: z.object({
    // 이미지는 확정된 파일 식별자로만 참조한다
    fileObjectId: z.string(),
    alt: z.string(),
    // 원본 이미지에 대한 0과 1 사이 비율
    crop: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      })
      .optional(),
    // 읽기 응답에만 붙는 임시 주소. 저장 요청에는 넣지 않는다
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

export const slideSchema = z.object({
  id: z.string(),
  presentationId: z.string(),
  generation: version,
  version,
  layoutId: z.string().nullable().optional(),
  elementIds: z.array(z.string()),
  elements: z.array(elementSchema),
})
export type Slide = z.infer<typeof slideSchema>

const sameOrder = (ids: string[], items: { id: string }[]) =>
  ids.length === items.length && ids.every((id, index) => items[index].id === id)

export const presentationSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    schemaVersion: z.literal(1),
    generation: version,
    version,
    orderVersion: version,
    // 모든 좌표의 기준. 화면 확대 값은 저장하지 않는다
    canvas: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
      unit: z.literal('px'),
    }),
    slideIds: z.array(z.string()),
    slides: z.array(slideSchema),
  })
  .superRefine((doc, context) => {
    // 스키마로 표현하지 못해 서버가 따로 검사하는 조건을 같이 확인한다
    if (!sameOrder(doc.slideIds, doc.slides)) {
      context.addIssue({ code: 'custom', message: 'slideIds와 slides의 순서가 다릅니다' })
    }
    for (const slide of doc.slides) {
      const consistent =
        slide.presentationId === doc.id &&
        slide.generation === doc.generation &&
        sameOrder(slide.elementIds, slide.elements) &&
        slide.elements.every((element) => element.slideId === slide.id)
      if (!consistent) {
        context.addIssue({ code: 'custom', message: `슬라이드 불일치 ${slide.id}` })
      }
    }
  })
export type Presentation = z.infer<typeof presentationSchema>

// 보낸 항목만 바꾸고 각 항목은 통째로 교체된다
export const elementPatchSchema = z.object({
  geometry: geometrySchema.optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  sourceRefs: z.array(sourceRefSchema).optional(),
})
export type ElementPatch = z.infer<typeof elementPatchSchema>

// 요소 수정 요청. Idempotency-Key 헤더와 함께 보낸다
export const elementSaveRequestSchema = z
  .object({
    generation: version,
    // 마지막으로 서버가 확인해 준 요소 버전
    baseVersion: version,
    editGroupId: z.string(),
    clientMutationId: z.string().min(1).max(64),
    finalizeGroup: z.boolean().optional(),
    patch: elementPatchSchema.optional(),
  })
  .refine((request) => request.patch !== undefined || request.finalizeGroup === true, {
    message: 'patch가 없으면 finalizeGroup이 true여야 합니다',
  })
export type ElementSaveRequest = z.infer<typeof elementSaveRequestSchema>

// 요소 변경 응답과 이벤트 payload가 함께 쓰는 항목
export const elementChangeSchema = z.object({
  resource: elementSchema,
  elementVersion: version.optional(),
  slideVersion: version.optional(),
  presentationVersion: version.optional(),
  orderVersion: version.optional(),
  generation: version.optional(),
  changeId: z.string().optional(),
})
export type ElementChange = z.infer<typeof elementChangeSchema>

// 요소 수정 성공 응답
export const elementSaveResultSchema = elementChangeSchema.extend({
  clientMutationId: z.string(),
  eventId: z.string(),
})
export type ElementSaveResult = z.infer<typeof elementSaveResultSchema>

// 편집 화면 동기화 스냅샷. 문서와 각 버전, 이벤트 커서를 같은 시점에서 읽은 묶음이다
export const editorSnapshotSchema = z.object({
  scope: z.literal('editor'),
  projectId: z.string(),
  eventCursor: z.string(),
  // 아직 생성 전이면 null
  presentation: presentationSchema.nullable(),
  members: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      isOwner: z.boolean(),
      membershipVersion: version,
    }),
  ),
  designSettings: z.looseObject({
    version,
    mode: z.enum(['unset', 'template', 'custom']),
  }),
  activeJobs: z.array(
    z.looseObject({
      id: z.string(),
      type: z.string(),
      status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
    }),
  ),
  // 문서가 참조하는 자료의 요약
  materials: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.enum(['file', 'link', 'memo']),
      version,
      deleted: z.boolean(),
    }),
  ),
})
export type EditorSnapshot = z.infer<typeof editorSnapshotSchema>

// 이벤트 구독의 presence.updated. 나를 뺀 팀원의 현재 커서 전체 목록이다
export const presenceUpdatedSchema = z.object({
  projectId: z.string(),
  cursors: z.array(z.object({ userId: z.string(), slideId: z.string(), x: z.number(), y: z.number() })),
})
export type PresenceCursor = z.infer<typeof presenceUpdatedSchema>['cursors'][number]
