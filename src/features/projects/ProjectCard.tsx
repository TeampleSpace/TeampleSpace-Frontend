import { Link } from 'react-router'
import type { Project } from './model.ts'
import styles from './Projects.module.css'
import buttons from '../../shared/ui/Button.module.css'

export function ProjectCard({ project }: { project: Project }) {
  return <article className={`${styles.card} ${styles.projectCard}`}>
    <div className={styles.projectTitle}>
      <div className={styles.greeting}>
        <p className={styles.small}>최근 변경 {new Date(project.updatedAt).toLocaleDateString('ko-KR')}</p>
        <h2><Link to={`/projects/${project.id}`}>{project.name}</Link></h2>
        <p className={styles.muted}>팀원 {project.memberCount}명</p>
      </div>
      <Link className={`${buttons.button} ${buttons.primary}`} to={`/projects/${project.id}`}>프로젝트 열기</Link>
    </div>
    {project.topic && <div className={styles.nextAction}><p>{project.topic}</p></div>}
    <div className={styles.actions}>
      <Link className={`${buttons.button} ${buttons.text}`} to={`/projects/${project.id}?team=1`}>팀원 관리</Link>
      <Link className={`${buttons.button} ${buttons.text}`} to={`/projects/${project.id}/settings`}>프로젝트 설정</Link>
    </div>
  </article>
}
