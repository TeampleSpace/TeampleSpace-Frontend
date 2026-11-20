import { Link } from 'react-router'
import { Button } from '../../shared/ui/Button.tsx'
import buttons from '../../shared/ui/Button.module.css'
import { useSession } from '../auth/sessionContext.ts'
import styles from './BillingPage.module.css'

const accountPath = '/account'
const subscriptionPath = '/account/subscription'
const managementPath = '/account/subscription/manage'
const secondaryLink = `${buttons.button} ${buttons.secondary}`

export function SubscriptionPage() {
  const { user } = useSession()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>개인 월 구독</h1>
          <p>내 계정으로 이용하는 월 구독이에요.</p>
        </div>
        <Link className={secondaryLink} to={accountPath}>내 계정</Link>
      </header>
      <div className={styles.banner}>
        <p className={styles.status}>월 구독 요금을 준비하고 있어요</p>
        <p>개발용 미리보기예요. 요금과 결제 조건이 정해지면 구독할 수 있어요.</p>
      </div>
      <div className={styles.columns}>
        <section className={styles.plan} aria-labelledby="subscription-plan">
          <h2 id="subscription-plan">TeamPleSpace 월 구독</h2>
          <dl className={styles.details}>
            <div><dt>구독 계정</dt><dd>{user?.email ?? user?.name ?? '계정 정보 없음'}</dd></div>
            <div><dt>결제 주기</dt><dd>매월</dd></div>
            <div><dt>제공 기능과 이용량</dt><dd>요금 공개 시 안내</dd></div>
          </dl>
          <div className={styles.conditions}>
            <h3>구독 전에 확인해 주세요</h3>
            <p>자동 갱신, 해지와 환불 조건은 구독 전에 확인할 수 있어요.</p>
          </div>
        </section>
        <section className={styles.panel} aria-labelledby="subscription-summary">
          <h2 id="subscription-summary">결제 요약</h2>
          <p className={styles.note}>개인 월 구독</p>
          <p className={styles.price}>가격 확정 예정</p>
          <p className={styles.note}>세금 포함 여부는 요금 공개 시 안내해요.</p>
          <div className={styles.summaryActions}>
            <Button disabled>요금 안내 준비 중</Button>
            <Link className={secondaryLink} to={managementPath}>구독 및 결제 관리</Link>
          </div>
        </section>
      </div>
    </div>
  )
}

export function BillingManagePage() {
  const { user } = useSession()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>구독 및 결제 관리</h1>
        <Link className={secondaryLink} to={accountPath}>내 계정</Link>
      </header>
      <section className={styles.narrow} aria-labelledby="billing-management">
        <h2 id="billing-management">개인 월 구독</h2>
        <dl className={styles.details}>
          <div><dt>구독 계정</dt><dd>{user?.email ?? user?.name ?? '계정 정보 없음'}</dd></div>
        </dl>
        <p className={styles.note}>결제 서비스가 열리면 구독 상태와 청구 내역을 확인할 수 있어요.</p>
        <div className={styles.actions}>
          <Button variant="secondary" disabled>결제 수단 및 청구 내역</Button>
          <Button variant="secondary" disabled>자동 갱신 관리</Button>
        </div>
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
          <Link className={`${buttons.button} ${buttons.primary}`} to={subscriptionPath}>결제 페이지로 돌아가기</Link>
        </div>
      </section>
    </div>
  )
}
