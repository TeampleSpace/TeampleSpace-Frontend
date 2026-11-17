import type { CSSProperties, ReactNode } from 'react'
import type { Element, Presentation, Slide } from '../../entities/presentation/schema.ts'
import styles from './SlideRenderer.module.css'
import { textStyle } from './textStyle.ts'

type Props = {
  canvas: Presentation['canvas']
  slide: Slide
  // 화면 배율. 문서 좌표는 바꾸지 않는다
  scale: number
  // 편집 중이라 따로 그리는 요소
  hiddenElementId?: string
  // 선택 표시 같은 편집 장식. 문서 좌표로 배치한다
  children?: ReactNode
}

function boxStyle(element: Element): CSSProperties {
  const { x, y, width, height, rotation } = element.geometry
  return {
    left: x,
    top: y,
    width,
    height,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  }
}

function ElementView({ element }: { element: Element }) {
  if (element.type === 'text') {
    return (
      <div className={styles.text} style={{ ...boxStyle(element), ...textStyle(element) }}>
        {element.content.text}
      </div>
    )
  }
  if (element.type === 'image') {
    return element.content.assetUrl ? (
      <img
        className={styles.image}
        style={boxStyle(element)}
        src={element.content.assetUrl}
        alt={element.content.alt}
        draggable={false}
      />
    ) : (
      <div className={styles.missing} style={boxStyle(element)}>
        {element.content.alt}
      </div>
    )
  }
  const { width, height } = element.geometry
  const { fill, stroke, strokeWidth } = element.style
  const paint = { fill, stroke, strokeWidth }
  return (
    <svg
      className={styles.shape}
      style={boxStyle(element)}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {element.content.shape === 'ellipse' ? (
        <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...paint} />
      ) : (
        <rect width={width} height={height} {...paint} />
      )}
    </svg>
  )
}

// 문서를 그리기만 한다. 네트워크 요청과 편집 상태는 다루지 않는다
// 텍스트와 이미지는 DOM, 도형은 SVG로 그린다
export function SlideRenderer({ canvas, slide, scale, hiddenElementId, children }: Props) {
  const elements = slide.elementIds
    .map((id) => slide.elements[id])
    .filter((element) => element && !element.deletedAt && element.id !== hiddenElementId)
    .sort((a, b) => a.geometry.z - b.geometry.z)

  return (
    <div
      className={styles.frame}
      style={{ width: canvas.width * scale, height: canvas.height * scale }}
    >
      <div
        className={styles.canvas}
        style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})` }}
      >
        {elements.map((element) => (
          <ElementView key={element.id} element={element} />
        ))}
        {children}
      </div>
    </div>
  )
}
