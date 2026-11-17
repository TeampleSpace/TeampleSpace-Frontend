import snapshotExample from '../../contracts/examples/sync-snapshot-editor.json'
import { editorSnapshotSchema } from '../entities/presentation/schema.ts'

// 백엔드와 함께 쓰는 편집 화면 스냅샷 예제. 문서는 파일 출력 실험과 같은 예제다
export const exampleSnapshot = editorSnapshotSchema.parse(snapshotExample)

// 예제 문서의 이미지 파일 식별자. contracts/examples/assets에 같은 이름의 파일이 있다
export const exampleImageFileId = '0193a000-0000-7000-8000-0000000000c1'
