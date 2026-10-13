'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Button, Skeleton } from 'antd';
import { ArrowRight, CalendarDays, Newspaper } from 'lucide-react';
import { fetcher } from '@/lib/api';
import { imageSrcSet, imageUrl } from '@/lib/image-url';
import styles from './HomeNewsSection.module.css';

type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  publishedAt?: string | null;
  createdAt: string;
};
type ArticleList = { items: Article[]; total: number };

const dateFormat = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
});

export function HomeNewsSection() {
  const featured = useSWR<ArticleList>('/articles?isFeatured=true&limit=5', fetcher);
  const latest = useSWR<ArticleList>('/articles?limit=9', fetcher);
  const featuredArticles = featured.data?.items || [];
  const latestArticles = latest.data?.items || [];
  const highlights = featuredArticles.length ? featuredArticles : latestArticles.slice(0, 5);
  const highlightIds = new Set(highlights.map((article) => article.id));
  const recent = latestArticles.filter((article) => !highlightIds.has(article.id)).slice(0, 6);
  const lead = highlights[0];
  const loading = !lead && (featured.isLoading || latest.isLoading);
  const failed = !lead && (featured.error || latest.error);

  const retry = () => { void featured.mutate(); void latest.mutate(); };

  return <div className={styles.news}>
    <section aria-labelledby="home-featured-heading">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>SportData Journal</p>
          <h1 id="home-featured-heading">Tin tức nổi bật</h1>
          <p className={styles.intro}>Cập nhật giải đấu, dấu ấn vận động viên và câu chuyện từ cộng đồng thể thao.</p>
        </div>
        <Link href="/news" className={styles.allNews}>Tất cả tin tức <ArrowRight size={17} /></Link>
      </div>
      {loading ? <div className={styles.loading} aria-busy="true" aria-label="Đang tải tin tức">
        <Skeleton.Image active className={styles.loadingImage} />
        <Skeleton active title paragraph={{ rows: 5 }} />
      </div> : lead ? <div className={`${styles.featuredGrid}${highlights.length === 1 ? ` ${styles.singleStory}` : ''}`}>
        <article className={styles.lead}>
          <Link href={`/news/${lead.slug}`} className={styles.leadLink}>
            <div className={styles.leadCover}>
              <ArticleCover article={lead} lead />
              <span className={styles.badge}>{featuredArticles.length ? 'Nổi bật' : 'Mới nhất'}</span>
            </div>
            <div className={styles.leadBody}>
              <ArticleDate article={lead} />
              <h2>{lead.title}</h2>
              {lead.excerpt && <p>{lead.excerpt}</p>}
              <span className={styles.readMore}>Đọc bài viết <ArrowRight size={17} /></span>
            </div>
          </Link>
        </article>
        {highlights.length > 1 && <div className={styles.storyList}>
          {highlights.slice(1).map((article) => <article key={article.id} className={styles.story}>
            <Link href={`/news/${article.slug}`} className={styles.storyLink}>
              <div className={styles.storyCover}><ArticleCover article={article} /></div>
              <div className={styles.storyBody}>
                <ArticleDate article={article} />
                <h2>{article.title}</h2>
                {article.excerpt && <p>{article.excerpt}</p>}
              </div>
            </Link>
          </article>)}
        </div>}
      </div> : <div className={styles.empty} role={failed ? 'status' : undefined}>
        <Newspaper size={36} strokeWidth={1.5} />
        <h2>{failed ? 'Chưa thể tải tin tức' : 'Tin tức sẽ sớm được cập nhật'}</h2>
        <p>{failed ? 'Vui lòng thử lại để xem các bài viết mới.' : 'Các bài viết mới từ SportData sẽ xuất hiện tại đây.'}</p>
        {failed && <Button onClick={retry}>Thử lại</Button>}
      </div>}
    </section>
    {recent.length > 0 && <section className={styles.latest} aria-labelledby="home-latest-heading">
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}>Tin tức & cập nhật</p><h2 id="home-latest-heading">Tin mới nhất</h2></div>
        <Link href="/news" className={styles.allNews}>Xem thêm <ArrowRight size={17} /></Link>
      </div>
      <div className={styles.latestGrid}>
        {recent.map((article) => <article key={article.id} className={styles.latestCard}>
          <Link href={`/news/${article.slug}`}>
            <div className={styles.latestCover}><ArticleCover article={article} /></div>
            <div className={styles.latestBody}>
              <ArticleDate article={article} />
              <h3>{article.title}</h3>
              {article.excerpt && <p>{article.excerpt}</p>}
              <span className={styles.readMore}>Đọc bài viết <ArrowRight size={16} /></span>
            </div>
          </Link>
        </article>)}
      </div>
    </section>}
    {lead && (featured.error || latest.error) && <div className={styles.partialError} role="status">
      <p>Một phần tin tức chưa tải được. Bạn có thể thử tải lại.</p><Button onClick={retry}>Thử lại</Button>
    </div>}
  </div>;
}

function ArticleCover({ article, lead = false }: { article: Article; lead?: boolean }) {
  const [failedSource, setFailedSource] = useState<string>();
  const source = article.coverImageUrl;
  if (!source || source === failedSource) return <div className={styles.coverPlaceholder} aria-hidden="true"><Newspaper size={lead ? 64 : 36} strokeWidth={1.25} /></div>;
  return (
    // Article covers are managed through the CMS and may use external image hosts.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl(source, lead ? 'hero' : 'card')} srcSet={lead ? imageSrcSet(source) : undefined}
      sizes={lead ? '(max-width: 800px) 100vw, 720px' : undefined} alt="" loading="lazy" decoding="async"
      onError={() => setFailedSource(source)} />
  );
}

function ArticleDate({ article }: { article: Article }) {
  const date = new Date(article.publishedAt || article.createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return <time className={styles.date} dateTime={date.toISOString()}><CalendarDays size={13} aria-hidden="true" />{dateFormat.format(date)}</time>;
}
