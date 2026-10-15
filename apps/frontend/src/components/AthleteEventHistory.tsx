'use client';

import Link from 'next/link';
import { Card, Table, Tag } from 'antd';
import { Calendar } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export type AthleteEventPerformance = {
  event: { id: string; name: string; startDate: string; endDate: string; location?: string };
  totalMatches: number; wins: number; losses: number; draws: number; pendingResults: number; upcomingMatches: number;
  goldMedals: number; silverMedals: number; bronzeMedals: number;
  categories: { id: string; name: string }[];
  achievements: { category: string; label: string }[];
};
export type AthletePerformance = Omit<AthleteEventPerformance, 'event' | 'categories' | 'achievements'> & {
  eventCount: number; winRate: number; events: AthleteEventPerformance[];
};

export function AthleteEventHistory({ events }: { events: AthleteEventPerformance[] }) {
  return <Card className="public-surface" title={<span className="flex items-center gap-2"><Calendar size={20} />Sự kiện & thành tích</span>} extra={<span className="text-sm text-slate-500">{events.length} sự kiện</span>}>
    <Table<AthleteEventPerformance>
      rowKey={(item) => item.event.id}
      dataSource={events}
      scroll={{ x: 700 }}
      pagination={events.length > 5 ? { pageSize: 5, showSizeChanger: false } : false}
      locale={{ emptyText: 'Chưa có lịch sử tham gia sự kiện.' }}
      columns={[
        { title: 'Sự kiện', width: 250, render: (_, item) => <div className="space-y-2">
          <Link href={`/events/${item.event.id}`} className="font-bold text-sky-500 hover:underline">{item.event.name}</Link>
          <p className="text-xs text-slate-500">{formatDate(item.event.startDate)} – {formatDate(item.event.endDate)}</p>
          {item.event.location && <p className="text-xs text-slate-500">{item.event.location}</p>}
          <div className="flex flex-wrap gap-1">{item.categories.map((category) => <Tag key={category.id}>{category.name}</Tag>)}</div>
        </div> },
        { title: 'Thi đấu', width: 170, render: (_, item) => <div className="space-y-2 text-sm">
          <p className="font-semibold">{item.totalMatches} trận đã đấu</p>
          <p><span className="text-emerald-500">{item.wins} thắng</span> · <span className="text-rose-500">{item.losses} thua</span> · {item.draws} hòa</p>
          {item.pendingResults > 0 && <p className="text-xs text-amber-500">{item.pendingResults} trận chờ công bố kết quả</p>}
          {item.upcomingMatches > 0 && <p className="text-xs text-slate-500">{item.upcomingMatches} trận sắp tới / đang đấu</p>}
        </div> },
        { title: 'Thành tích', width: 240, render: (_, item) => <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {item.goldMedals > 0 && <Tag color="gold">{item.goldMedals} Vàng</Tag>}
            {item.silverMedals > 0 && <Tag>{item.silverMedals} Bạc</Tag>}
            {item.bronzeMedals > 0 && <Tag color="orange">{item.bronzeMedals} Đồng</Tag>}
          </div>
          {item.achievements.map((achievement, index) => <p key={index} className="text-xs">{achievement.label} · {achievement.category}</p>)}
          {!item.goldMedals && !item.silverMedals && !item.bronzeMedals && <p className="text-sm text-slate-500">{item.totalMatches ? 'Chưa ghi nhận huy chương' : 'Chưa có kết quả thi đấu'}</p>}
        </div> },
      ]}
    />
  </Card>;
}
