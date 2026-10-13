'use client';

import { useState } from 'react';
import { DateTimeFields } from '@/components/DateTimeFields';
import { Button, Space, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { useSportDataToast } from '@/hooks/useSportDataToast';

dayjs.extend(utc);
dayjs.extend(timezone);
const zone = 'Asia/Ho_Chi_Minh';

type MatchSchedule = {
  id: string; matchNumber?: number; matchDate: string; startTime?: string | null;
  endTime?: string | null; status: string; scheduleLocked?: boolean;
};

export function InlineMatchSchedule({ match, canEdit, event, onSaved }: {
  match: MatchSchedule; canEdit: boolean; event: { startDate: string; endDate: string };
  onSaved: (updated: MatchSchedule) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<Dayjs | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useSportDataToast();
  const blocked = match.status === 'RUNNING' ? 'Trận đang thi đấu, không thể đổi thời gian'
    : match.scheduleLocked ? 'Mở khóa lịch trước khi đổi thời gian' : undefined;
  const label = match.startTime ? dayjs(match.startTime).tz(zone).format('HH:mm DD/MM/YYYY')
    : `${dayjs(match.matchDate).tz(zone).format('DD/MM/YYYY')} · Chưa xếp giờ`;

  const save = async () => {
    if (!value || saving || blocked) return;
    setSaving(true);
    try {
      // The picker edits Vietnam wall time, independent of the browser's timezone.
      const start = dayjs(value.format('YYYY-MM-DDTHH:mm:ss') + '+07:00');
      const duration = match.startTime && match.endTime
        ? dayjs(match.endTime).diff(dayjs(match.startTime)) : 0;
      const { data } = await api.patch<MatchSchedule>(`/matches/${match.id}`, {
        matchDate: start.toISOString(), startTime: start.toISOString(),
        ...(duration > 0 ? { endTime: start.add(duration, 'millisecond').toISOString() } : {}),
      });
      await onSaved(data);
      setEditing(false);
      toast.success('Đã cập nhật ngày và giờ thi đấu.');
    } catch (error: any) {
      const message = error.response?.data?.message;
      toast.error(Array.isArray(message) ? message.join(', ') : message || 'Không thể cập nhật thời gian thi đấu.');
    } finally { setSaving(false); }
  };

  if (editing) return <div className="space-y-2 py-1">
    <DateTimeFields className="w-full" size="large" label={`Thi đấu trận ${match.matchNumber || match.id}`} value={value} onChange={setValue}
      allowClear={false} disabled={saving || Boolean(blocked)}
      defaultPickerValue={dayjs(match.startTime || match.matchDate).tz(zone)}
      disabledDate={(date) => { const key = date.format('YYYY-MM-DD'); return key < dayjs(event.startDate).tz(zone).format('YYYY-MM-DD') || key > dayjs(event.endDate).tz(zone).format('YYYY-MM-DD'); }} />
    <Space size={6}><Button type="primary" size="small" loading={saving} disabled={!value || Boolean(blocked)} onClick={() => void save()}>Lưu</Button><Button size="small" disabled={saving} onClick={() => setEditing(false)}>Hủy</Button></Space>
    <p className="text-xs text-slate-500">Giờ Việt Nam · Giữ thời lượng trận đã xếp</p>
  </div>;
  return <div className="flex items-center justify-between gap-2"><span>{label}</span>{canEdit && <Tooltip title={blocked || 'Sửa ngày và giờ thi đấu'}><Button type="text" size="small" aria-label={`Sửa thời gian trận ${match.matchNumber || match.id}`} disabled={Boolean(blocked)} icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setValue(match.startTime ? dayjs(match.startTime).tz(zone) : null); setEditing(true); }} /></Tooltip>}</div>;
}
