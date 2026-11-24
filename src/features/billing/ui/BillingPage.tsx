import { Link } from 'react-router'
import { Button } from '../../../shared/ui/Button.tsx'
import buttons from '../../../shared/ui/Button.module.css'
import { useSession } from '../../../entities/session/sessionContext.ts'
import styles from './BillingPage.module.css'

const accountPath = '/account'
const subscriptionPath = '/account/subscription'
const managementPath = '/account/subscription/manage'
const completePreviewPath = '/account/subscription/preview/complete'
const interruptedPreviewPath = '/account/subscription/preview/interrupted'
const primaryLink = `${buttons.button} ${buttons.primary}`
const secondaryLink = `${buttons.button} ${buttons.secondary}`
// 요금제 기획안에서 확정된 가격과 제공량
const plans = [
  ['무료', '0원, AI 호출 월 1회, 프로젝트 1개'],
  ['일반', '월 3,500원, AI 호출 월 10회, 프로젝트 3개까지'],
  ['프로', '월 7,500원, AI 호출 월 30회, 프로젝트 무제한, 추가 템플릿'],
]

export function SubscriptionPage() {
  const { user } = useSession()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>개인 월 구독</h1>
        <Link className={secondaryLink} to={accountPath}>내 계정</Link>
      </header>
      <p className={styles.note}>내 계정에 적용되는 구독이에요. 프로젝트의 다른 팀원에게는 결제되지 않습니다.</p>
      <div className={styles.banner}>
        <p className={styles.status}>결제 서비스를 준비하고 있어요</p>
        <p>요금과 제공 기능은 정해졌어요. 결제 서비스가 연결되면 구독을 시작할 수 있고, 지금은 결제되지 않습니다.</p>
      </div>
      <div className={styles.columns}>
        <section className={styles.plan} aria-labelledby="subscription-plan">
          <h2 id="subscription-plan">TeamPleSpace 월 구독</h2>
          <p className={styles.lead}>한 달씩, 내 계정으로 이용하기</p>
          <dl className={styles.details}>
            <div><dt>구독 계정</dt><dd>{user?.email ?? user?.name ?? '계정 정보 없음'}</dd></div>
            <div><dt>결제 주기</dt><dd>매월</dd></div>
            {plans.map(([name, terms]) => <div key={name}><dt>{name}</dt><dd>{terms}</dd></div>)}
          </dl>
          <div className={styles.conditions}>
            <h3>구독 전에 확인해 주세요</h3>
            <p>정기 결제 금액, 갱신 조건과 해지, 환불 안내를 확인한 뒤 결제할 수 있습니다.</p>
            <p>카드 등 결제 정보는 결제 서비스의 안전한 화면에서 입력합니다.</p>
          </div>
        </section>
        <section className={styles.panel} aria-labelledby="subscription-summary">
          <h2 id="subscription-summary">결제 요약</h2>
          <p className={styles.note}>개인 월 구독</p>
          <p className={styles.price}>월 3,500원부터</p>
          <p className={styles.note}>일반은 월 3,500원, 프로는 월 7,500원이에요. 세금 포함 여부는 결제 전에 안내합니다.</p>
          <Button className={styles.purchase} disabled>결제 서비스 준비 중</Button>
          <p className={styles.caption}>결제 서비스가 연결되기 전에는 구독이 시작되지 않습니다.</p>
        </section>
      </div>
      <nav className={styles.actions} aria-label="구독 화면 이동">
        <Link className={secondaryLink} to={managementPath}>구독 및 결제 관리</Link>
        <Link className={secondaryLink} to={completePreviewPath}>구독 완료 미리보기</Link>
        <Link className={secondaryLink} to={interruptedPreviewPath}>결제 중단 미리보기</Link>
      </nav>
    </div>
  )
}

export function BillingManagePage() {
  const { user } = useSession()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>구독 및 결제 관리</h1>
        <div className={styles.actions}>
          <p className={styles.previewLabel}>개발용 미리보기</p>
          <Link className={secondaryLink} to={accountPath}>내 계정</Link>
        </div>
      </header>
      <section className={styles.narrow} aria-labelledby="billing-management">
        <h2 id="billing-management">일반 플랜, 월 3,500원</h2>
        <p className={styles.active}>이용 중</p>
        <dl className={styles.details}>
          <div><dt>구독 계정</dt><dd>{user?.email ?? user?.name ?? '계정 정보 없음'}</dd></div>
        </dl>
        <p className={styles.note}>AI 호출 월 10회, 직접 만드는 프로젝트 3개까지예요. 다음 결제일은 결제 내역에서 확인하세요.</p>
        <div className={styles.actions}>
          <Button variant="secondary" disabled>결제 수단 및 청구 내역</Button>
          <Button variant="secondary" disabled>자동 갱신 관리</Button>
        </div>
        <p className={styles.caption}>결제 서비스 연결 후 구독 관리가 제공됩니다.</p>
      </section>
      <div><Link className={secondaryLink} to={subscriptionPath}>요금제 보기</Link></div>
    </div>
  )
}

export function BillingReturnPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>결제 확인</h1>
        <Link className={secondaryLink} to={accountPath}>내 계정</Link>
      </header>
      <section className={styles.narrow} aria-labelledby="billing-result">
        <h2 className={styles.resultTitle} id="billing-result">결제 결과를 확인할 수 없어요</h2>
        <p className={styles.note}>결제 서비스가 열리면 여기에서 결과를 확인할 수 있어요.</p>
        <div className={styles.actions}>
          <Link className={primaryLink} to={subscriptionPath}>결제 페이지로 돌아가기</Link>
        </div>
      </section>
    </div>
  )
}

const outcomePreviews = {
  complete: {
    pageTitle: '구독 완료',
    title: '개인 구독이 시작됐어요',
    description: '결제 내역과 다음 결제 조건은 구독 관리에서 확인할 수 있어요.',
    primaryAction: { to: '/', label: '프로젝트로 돌아가기' },
    secondaryAction: { to: managementPath, label: '구독 관리' },
  },
  interrupted: {
    pageTitle: '결제 중단',
    title: '결제가 완료되지 않았어요',
    description: '구독이 시작되지 않았습니다. 결제 조건을 다시 확인하고 진행해 주세요.',
    primaryAction: { to: subscriptionPath, label: '결제 페이지로 돌아가기' },
    secondaryAction: { to: accountPath, label: '내 계정' },
  },
}

function BillingOutcomePreview({ outcome }: { outcome: keyof typeof outcomePreviews }) {
  const { user } = useSession()
  const { pageTitle, title, description, primaryAction, secondaryAction } = outcomePreviews[outcome]
  const titleClass = outcome === 'complete' ? `${styles.resultTitle} ${styles.resultSuccess}` : styles.resultTitle

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{pageTitle}</h1>
        <div className={styles.actions}>
          <p className={styles.previewLabel}>개발용 미리보기</p>
          <Link className={secondaryLink} to={accountPath}>내 계정</Link>
        </div>
      </header>
      <section className={styles.narrow} aria-labelledby="billing-preview-result">
        <h2 className={titleClass} id="billing-preview-result">{title}</h2>
        {outcome === 'complete' && user?.email && <p>{user.email} 계정에 구독이 적용되었습니다.</p>}
        <p className={styles.note}>{description}</p>
        <div className={styles.actions}>
          <Link className={primaryLink} to={primaryAction.to}>{primaryAction.label}</Link>
          <Link className={secondaryLink} to={secondaryAction.to}>{secondaryAction.label}</Link>
        </div>
      </section>
    </div>
  )
}

export function BillingCompletePreviewPage() {
  return <BillingOutcomePreview outcome="complete" />
}

export function BillingInterruptedPreviewPage() {
  return <BillingOutcomePreview outcome="interrupted" />
}
