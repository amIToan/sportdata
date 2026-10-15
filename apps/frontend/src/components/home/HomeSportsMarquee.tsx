'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { imageUrl } from '@/lib/image-url';
import styles from './HomeSportsMarquee.module.css';

type Pictogram = 'athletics' | 'combat' | 'dance' | 'gymnastics' | 'strength' | 'team' | 'swimming' | 'target';

type Sport = {
  id: string;
  name: string;
  code: string;
  displayName?: string | null;
  logoUrl?: string | null;
  isVisible?: boolean;
};

type MarqueeSport = {
  id: string;
  name: string;
  href: string;
  logoUrl?: string | null;
  pictogram: Pictogram;
};

const sportGroups: MarqueeSport[] = [
  { id: 'athletics', name: 'Điền kinh', pictogram: 'athletics', href: '/events' },
  { id: 'combat', name: 'Võ thuật & đối kháng', pictogram: 'combat', href: '/events' },
  { id: 'dance', name: 'Khiêu vũ thể thao', pictogram: 'dance', href: '/events' },
  { id: 'gymnastics', name: 'Thể dục', pictogram: 'gymnastics', href: '/events' },
  { id: 'strength', name: 'Thể thao sức mạnh', pictogram: 'strength', href: '/events' },
  { id: 'team', name: 'Môn đồng đội', pictogram: 'team', href: '/events' },
  { id: 'swimming', name: 'Thể thao dưới nước', pictogram: 'swimming', href: '/events' },
  { id: 'target', name: 'Các môn mục tiêu', pictogram: 'target', href: '/events' },
];

function sportPictogram(sport: Sport): Pictogram {
  const name = `${sport.code} ${sport.name} ${sport.displayName || ''}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

  if (/(swim|water|diving|boi|nuoc|rowing|canoe)/.test(name)) return 'swimming';
  if (/(dance|khieu vu)/.test(name)) return 'dance';
  if (/(gymnast|the duc)/.test(name)) return 'gymnastics';
  if (/(weight|strength|cu ta|suc manh|powerlift)/.test(name)) return 'strength';
  if (/(archery|shoot|target|ban cung|ban sung|muc tieu)/.test(name)) return 'target';
  if (/(football|basket|volley|bong|team|dong doi|futsal|hockey)/.test(name)) return 'team';
  if (/(athlet|track|run|dien kinh|marathon)/.test(name)) return 'athletics';
  return 'combat';
}

export function HomeSportsMarquee() {
  const { data } = useSWR<Sport[]>('/sports', fetcher);
  const sports = useMemo<MarqueeSport[]>(() => {
    const visibleSports = Array.isArray(data)
      ? data.filter((sport) => sport.isVisible !== false && sport.code && sport.name)
      : [];

    return visibleSports.length ? visibleSports.map((sport) => ({
      id: sport.id,
      name: sport.displayName || sport.name,
      href: `/sports/${encodeURIComponent(sport.code.toLowerCase())}`,
      logoUrl: sport.logoUrl,
      pictogram: sportPictogram(sport),
    })) : sportGroups;
  }, [data]);
  // Keep the repeating band wider than a desktop viewport even with few CMS records.
  const repetitions = Math.max(1, Math.ceil(12 / sports.length));

  return (
    <section className={styles.marquee} aria-label="Các bộ môn thể thao">
      <nav className={styles.viewport} aria-label="Khám phá bộ môn">
        <div className={styles.track} style={{ animationDuration: `${sports.length * repetitions * 4.5}s` }}>
          {[false, true].map((duplicateGroup) => (
            <ul
              key={String(duplicateGroup)}
              className={`${styles.group}${duplicateGroup ? ` ${styles.duplicateGroup}` : ''}`}
              aria-hidden={duplicateGroup || undefined}
            >
              {Array.from({ length: repetitions }, (_, repetition) => sports.map((sport) => {
                const duplicate = duplicateGroup || repetition > 0;
                return (
                  <li
                    key={`${repetition}-${sport.id}`}
                    className={repetition > 0 ? styles.repeatedItem : undefined}
                    aria-hidden={duplicate || undefined}
                  >
                    <Link
                      href={sport.href}
                      className={styles.item}
                      tabIndex={duplicate ? -1 : undefined}
                      prefetch={false}
                      title={sport.name}
                    >
                      <SportIcon key={sport.logoUrl || sport.pictogram} sport={sport} />
                      <span className={styles.name}>{sport.name}</span>
                    </Link>
                  </li>
                );
              }))}
            </ul>
          ))}
        </div>
      </nav>
    </section>
  );
}

function SportIcon({ sport }: { sport: MarqueeSport }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <span className={styles.icon} aria-hidden="true">
      {sport.logoUrl && !imageFailed ? (
        // CMS logos may use arbitrary storage or public image hosts.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl(sport.logoUrl, 'logo')}
          alt=""
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : <SportPictogram kind={sport.pictogram} />}
    </span>
  );
}

function SportPictogram({ kind }: { kind: Pictogram }) {
  const figures = {
    athletics: <>
      <circle cx="38" cy="10" r="4.5" />
      <path d="m33 19-8 12 12 8-8 16M31 23l-12-3-8 8M34 22l9 8 10-2M37 39l12 12 9 1" />
    </>,
    combat: <>
      <circle cx="29" cy="10" r="4.5" />
      <path d="m29 19 5 18-10 19M31 23l-13 6-9-4M33 26l13-7 8 3M34 37l13-5 11 6" />
    </>,
    dance: <>
      <circle cx="27" cy="10" r="4" />
      <circle cx="45" cy="17" r="4" />
      <path d="m27 19 4 16-12 18M28 23l-12-5-6-9M31 35l9 18M32 23l9 5 13-6M42 27l-5 14 15 12" />
    </>,
    gymnastics: <>
      <circle cx="32" cy="26" r="4.5" />
      <path d="m32 36-9 7-15-3M32 36l10 7 14-3M24 41l-6 15M42 43l6 13M32 36V14M32 15 18 7M32 15l14-8" />
    </>,
    strength: <>
      <circle cx="32" cy="23" r="4.5" />
      <path d="M32 33v11l-9 12M32 44l9 12M32 35l-13-9V13M32 35l13-9V13" />
      <path d="M8 12h48M11 7v10M16 5v14M48 5v14M53 7v10" strokeWidth="3.5" />
    </>,
    team: <>
      <circle cx="27" cy="10" r="4.5" />
      <path d="m27 19 6 17-12 18M28 23l-13 7-6-3M31 23l11 6 9-4M33 36l10 10 9-1" />
      <circle cx="55" cy="54" r="5" />
    </>,
    swimming: <>
      <circle cx="48" cy="28" r="4.5" />
      <path d="m15 32 17-6 8 9M32 26l-8-12-11 3" />
      <path d="M5 44q7-6 14 0t14 0 14 0 12 0M5 54q7-6 14 0t14 0 14 0 12 0" strokeWidth="3" />
    </>,
    target: <>
      <circle cx="25" cy="10" r="4.5" />
      <path d="M25 19v20l-10 16M25 39l10 16M25 24l20-1M25 24l-10 4 9 5" />
      <path d="M46 8q17 16 0 32M46 8v32M39 23h19m-4-3 4 3-4 3" strokeWidth="2" />
    </>,
  };

  return (
    <svg viewBox="0 0 64 64" fill="currentColor" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <g fill="none">{figures[kind]}</g>
    </svg>
  );
}
