'use client';

import { useState } from 'react';
import { Button, Card, Empty, Select, Space, Tag } from 'antd';
import { localTime } from './schedule-ui';

export function ScheduleOverviewGrid({ overview, canEdit, onCreate, onOpen }: {
  overview: any; canEdit: boolean; onCreate: (day?: string, fopId?: string) => void;
  onOpen: (id: string, day?: string) => void;
}) {
  const [day, setDay] = useState<string>();
  const cell = (date: string, fop: any) => {
    const segments = overview.segments.filter((item: any) => item.localDate === date && item.fopId === fop.id)
      .sort((a: any, b: any) => a.start - b.start);
    return <div className="min-w-60 space-y-3 p-3">
      {segments.length ? segments.map((item: any) => <SchedulePlanCard key={`${item.planId || item.matchId}:${date}`}
        segment={item} timezone={overview.timezone} onOpen={item.legacy ? undefined : () => onOpen(item.planId, date)} />)
        : <p className="py-4 text-sm text-slate-500">Chưa có lịch</p>}
      {canEdit && <Button block type="dashed" onClick={() => onCreate(date, fop.id)}>+ Tạo lịch</Button>}
    </div>;
  };
  if (!overview.fops.length) return <Empty description={<span>Chưa có sân/thảm. <a href={`/cms/events/${overview.eventId}?tab=fops`}>Thêm sân thi đấu tại Sàn / FOP</a>.</span>} />;
  return <>
    <div className="hidden overflow-auto rounded-xl border border-slate-200 md:block">
      <table className="w-full border-collapse"><thead><tr><th className="p-4 text-left">Ngày</th>
        {overview.fops.map((fop: any) => <th key={fop.id} className="p-4 text-left">{fop.name}</th>)}</tr></thead>
        <tbody>{overview.days.map((date: string) => <tr key={date} className="border-t border-slate-200 align-top">
          <th className="whitespace-nowrap p-4 text-left">{date.split('-').reverse().join('/')}</th>
          {overview.fops.map((fop: any) => <td key={fop.id} className="border-l border-slate-200">{cell(date, fop)}</td>)}
        </tr>)}</tbody></table>
    </div>
    <div className="space-y-4 md:hidden"><Select aria-label="Ngày xem lịch" className="w-full" value={day || overview.days[0]}
      options={overview.days.map((date: string) => ({ value: date, label: date.split('-').reverse().join('/') }))} onChange={setDay} />
      {overview.fops.map((fop: any) => <Card key={fop.id} title={fop.name}>{cell(day || overview.days[0], fop)}</Card>)}
    </div>
  </>;
}

export function SchedulePlanCard({ segment, timezone, onOpen }: { segment: any; timezone: string; onOpen?: () => void }) {
  return <Card size="small" className="border-l-4 border-l-blue-500" title={<span className="whitespace-normal">{segment.legacy ? segment.name.replace('Lịch hiện có · ', '') : segment.name}</span>}>
    <Space direction="vertical" className="w-full">
      <span>{localTime(segment.start, timezone)}–{segment.end ? localTime(segment.end, timezone) : 'Chưa có giờ kết thúc'}</span>
      <span>{segment.count} trận đã xếp</span>
      <span className="line-clamp-2 text-xs text-slate-500" title={segment.contents?.join(', ')}>{segment.contents?.join(', ')}</span>
      <Space wrap>{segment.continuation && <Tag color="blue">Tiếp tục</Tag>}<Tag>Đang áp dụng</Tag>{segment.hasDraft && <Tag color="gold">Có thay đổi chưa áp dụng</Tag>}</Space>
      {onOpen && <Button onClick={onOpen}>Mở lịch</Button>}
    </Space>
  </Card>;
}
