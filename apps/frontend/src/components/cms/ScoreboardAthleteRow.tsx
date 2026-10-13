'use client';

import { useState } from 'react';
import Image from 'next/image';
import { UserRound } from 'lucide-react';
import { imageUrl } from '@/lib/image-url';
import { auxiliaryTimerDisplay, type AuxiliaryTimerMode, type ScoreboardAuxiliaryTimers } from '@/lib/scoreboard-timers';
import { formatScoreboardTime } from '@/lib/scoreboard-history';
import styles from './MatchScoreboard.module.css';

type Props = {
  side: 1 | 2;
  athleteId?: string;
  athleteName: string;
  athletePhotoUrl?: string | null;
  athleteUnit: string;
  score: number;
  penalties: number;
  advantages: number;
  hasReviewCard: boolean;
  reviewPending: boolean;
  timers?: ScoreboardAuxiliaryTimers[1];
  timerMode: AuxiliaryTimerMode;
  now: number;
};

export function ScoreboardAthleteRow({ side, athleteId, athleteName, athletePhotoUrl, athleteUnit, score, penalties, advantages, hasReviewCard, reviewPending, timers, timerMode, now }: Props) {
  const corner = side === 1 ? 'Đỏ' : 'Xanh';
  const avatarUrl = imageUrl(athletePhotoUrl || (athleteId ? `/api/participant-auth/avatar/${athleteId}` : undefined), 'portrait');
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string>();
  const timer = auxiliaryTimerDisplay(timers, timerMode, now);
  const timerLabel = `${timer.mode === 'medical' ? 'Y tế' : timer.mode === 'stall' ? 'Thụ động' : 'Timer phụ'} ${corner}`;
  return (
    <section className={`${styles.row} ${side === 1 ? styles.red : styles.cyan}`} aria-label={`Bảng điểm ${corner}: ${athleteName}`}>
      <div className={styles.avatar}>
        {avatarUrl && failedAvatarUrl !== avatarUrl ? (
          <Image src={avatarUrl} alt={`Ảnh đại diện ${athleteName}`} fill unoptimized sizes="10vw" className={styles.avatarImage} onError={() => setFailedAvatarUrl(avatarUrl)} />
        ) : <UserRound className={styles.avatarPlaceholder} aria-hidden="true" />}
      </div>
      <div className={styles.athleteInfo}>
        <h2 className={styles.athleteName} title={athleteName}>{athleteName}</h2>
        <p className={styles.athleteUnit} title={athleteUnit}>{athleteUnit}</p>
      </div>
      <div className={styles.points}>
        <span className={styles.advantageLabel} aria-hidden="true">A</span>
        <span className={styles.advantageCount} aria-label={`Số lợi thế ${corner}`}>{advantages}</span>
        {hasReviewCard && reviewPending && <div className={`${styles.videoReview} ${styles.videoReviewPending}`} role="img" aria-label={`Thẻ VR ${corner}: Đang xem lại`}><span>VR</span></div>}
        <span className={styles.score} aria-label={`Điểm ${athleteName}`}>{score}</span>
      </div>
      <div className={styles.penalties} role="group" aria-label={`Mốc phạt ${corner}: ${athleteName}`}>
        <strong>PENALTIES</strong>
        {[1, 2, 3, 4].map((level) => {
          const lit = penalties >= level;
          return <span
            key={level}
            className={`${styles.penalty} ${lit ? styles.penaltyLit : ''}`}
            aria-label={`${level}P ${corner}: ${athleteName}${lit ? ' · Đã ghi nhận' : ''}`}
            data-active={lit}
          >{level}</span>;
        })}
      </div>
      <span className={`${styles.auxiliaryTimer} ${timer.exhausted ? styles.timerExhausted : timer.active ? styles.timerActive : ''}`} role="timer" aria-label={timerLabel} data-mode={timer.mode || 'idle'} title={timerLabel}>{formatScoreboardTime(timer.remainingMs)}</span>
    </section>
  );
}
