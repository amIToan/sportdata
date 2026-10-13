'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Alert, Button, Card, Col, DatePicker, Form, Input, Row, Select, Tag } from 'antd';
import { api, fetcher } from '@/lib/api';
import { FormActions } from './AthleteForm';
import { RemoteAthleteSelect } from './RemoteAthleteSelect';
import { MatchScoreboardHistory } from './MatchScoreboardHistory';
import { PairMatchResult } from './PairMatchResult';
import { MatchResultCorrection } from './MatchResultCorrection';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { MATCH_STATUS_META, RESULT_STATUS_META, WIN_METHOD_LABELS } from '@/lib/vi-labels';

const matchSchema = z.object({
  eventId: z.string().min(1, 'Vui lòng chọn sự kiện'),
  categoryId: z.string().min(1, 'Vui lòng chọn hạng mục'),
  athlete1Id: z.string().optional(),
  athlete2Id: z.string().optional(),
  matchDate: z.string().min(1, 'Vui lòng chọn thời gian thi đấu'),
  matchNumber: z.string().optional(),
  fop: z.string().optional(),
  fopId: z.string().optional(),
  status: z.enum(['SCHEDULED', 'RUNNING', 'FINISHED', 'CANCELLED']),
  matchType: z.enum(['POOL', 'ELIMINATION', 'FINAL', 'SEMIFINAL', 'QUARTERFINAL', 'ROUND_OF_16', 'ROUND_OF_32', 'GROUP_STAGE']),
  round: z.string().optional(),
  pool: z.string().optional(),
  notes: z.string().optional(),
}).refine((values) => !values.athlete1Id || !values.athlete2Id || values.athlete1Id !== values.athlete2Id, {
  message: 'Hai vận động viên phải khác nhau',
  path: ['athlete2Id'],
});

type MatchFormValues = z.infer<typeof matchSchema>;
const toLocalInput = (value?: string) => value ? dayjs(value).format('YYYY-MM-DDTHH:mm') : '';

const matchTypeOptions = [
  { value: 'POOL', label: 'Vòng bảng' },
  { value: 'ELIMINATION', label: 'Loại trực tiếp' },
  { value: 'ROUND_OF_32', label: 'Vòng 32' },
  { value: 'ROUND_OF_16', label: 'Vòng 16' },
  { value: 'QUARTERFINAL', label: 'Tứ kết' },
  { value: 'SEMIFINAL', label: 'Bán kết' },
  { value: 'FINAL', label: 'Chung kết' },
  { value: 'GROUP_STAGE', label: 'Vòng bảng mở rộng' },
];
const statusOptions = [
  { value: 'SCHEDULED', label: 'Sắp diễn ra' },
  { value: 'RUNNING', label: 'Đang thi đấu · bắt đầu tại Bảng điểm', disabled: true },
  { value: 'FINISHED', label: 'Hoàn thành · quản lý tại Điều hành', disabled: true },
  { value: 'CANCELLED', label: 'Đã hủy' },
];

export function MatchForm({ matchId, initialData, returnTo = '/cms/events' }: { matchId?: string; initialData?: any; returnTo?: string }) {
  const router = useRouter();
  const toast = useSportDataToast();
  const [correctingResult, setCorrectingResult] = useState(false);
  const { data: currentUser } = useSWR<any>('/auth/profile', fetcher);
  const { data: eventsResponse } = useSWR<any>('/events?limit=200', fetcher);
  const { data: categoriesResponse } = useSWR<any>('/categories?limit=200', fetcher);
  const events = eventsResponse?.items || [];
  const categories = categoriesResponse?.items || [];
  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MatchFormValues>({
    resolver: zodResolver(matchSchema),
    defaultValues: {
      eventId: initialData?.eventId || '',
      categoryId: initialData?.categoryId || '',
      athlete1Id: initialData?.athlete1Id || '',
      athlete2Id: initialData?.athlete2Id || '',
      matchDate: toLocalInput(initialData?.matchDate || initialData?.startTime),
      matchNumber: initialData?.matchNumber != null ? String(initialData.matchNumber) : '',
      fop: initialData?.fop || '',
      fopId: initialData?.fopId || '',
      status: initialData?.status || 'SCHEDULED',
      matchType: initialData?.matchType || 'ELIMINATION',
      round: initialData?.round != null ? String(initialData.round) : '',
      pool: initialData?.pool || '',
      notes: initialData?.notes || '',
    },
  });
  const selectedEventId = watch('eventId');
  const selectedCategoryId = watch('categoryId');
  const selectedAthlete1Id = watch('athlete1Id');
  const selectedAthlete2Id = watch('athlete2Id');
  const { data: selectedEventDetails } = useSWR<any>(
    selectedEventId ? `/events/${selectedEventId}` : null,
    fetcher,
  );
  const selectedEvent = selectedEventDetails
    || events.find((event: any) => event.id === selectedEventId);

  const onSubmit = async (values: MatchFormValues) => {
    const date = new Date(values.matchDate).toISOString();
    const selectedFop = selectedEvent?.fops?.find((fop: any) => fop.id === values.fopId);
    const payload = {
      ...values,
      matchDate: date,
      startTime: date,
      athlete1Id: values.athlete1Id || undefined,
      athlete2Id: values.athlete2Id || undefined,
      matchNumber: values.matchNumber ? Number(values.matchNumber) : undefined,
      round: values.round ? Number(values.round) : undefined,
      fopId: values.fopId || undefined,
      fop: selectedFop?.name || values.fop || undefined,
      pool: values.pool || undefined,
      notes: values.notes || undefined,
    };
    try {
      if (matchId) await api.patch(`/matches/${matchId}`, payload);
      else await api.post('/matches', payload);
      toast.success(matchId ? 'Đã cập nhật trận đấu.' : 'Đã tạo trận đấu.');
      router.push(matchId ? returnTo : `/cms/events/${values.eventId}?tab=matches`);
      router.refresh();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Không thể lưu trận đấu';
      toast.error(Array.isArray(message) ? message.join(', ') : message);
    }
  };

  const eventOptions = events.map((event: any) => ({ value: event.id, label: event.name }));
  const eventCategories = selectedEvent?.categories?.length ? selectedEvent.categories : categories;
  const categoryOptions = eventCategories.map((category: any) => ({
    value: category.id,
    label: `${category.name}${category.sport?.name ? ` · ${category.sport.name}` : ''}`,
  }));
  const initialAthletes = [initialData?.athlete1, initialData?.athlete2].filter(Boolean);
  const winnerName = initialData?.winner?.fullName
    || (initialData?.winnerId === initialData?.athlete1Id ? initialData?.athlete1?.fullName : null)
    || (initialData?.winnerId === initialData?.athlete2Id ? initialData?.athlete2?.fullName : null);

  return (
    <Form layout="vertical" requiredMark={false} onFinish={handleSubmit(onSubmit)}>
      {matchId && (initialData?.team1 || initialData?.team2) && <PairMatchResult matchId={matchId} />}
      {matchId && !initialData?.team1 && !initialData?.team2 && (
        <Card
          className="cms-surface mb-5"
          title="Kết quả từ bảng điểm"
          extra={<div className="flex flex-wrap gap-2"><Button href={`/cms/matches/${matchId}/scoreboard`} target="sportdata-scoreboard">Mở bảng điểm</Button>{initialData?.status === 'FINISHED' && initialData?.athlete1 && initialData?.athlete2 && ['ADMIN', 'GAMES_ADMIN'].includes(currentUser?.role) && <Button onClick={() => setCorrectingResult(true)}>Sửa kết quả</Button>}</div>}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                athlete: initialData?.athlete1,
                score: initialData?.athlete1Score,
                advantages: initialData?.athlete1Advantages,
                penalties: initialData?.athlete1Penalties,
              },
              {
                athlete: initialData?.athlete2,
                score: initialData?.athlete2Score,
                advantages: initialData?.athlete2Advantages,
                penalties: initialData?.athlete2Penalties,
              },
            ].map((side, index) => (
              <div key={side.athlete?.id || index} className="rounded-xl border border-slate-700/80 bg-slate-950/30 p-4">
                <div className="truncate text-sm text-slate-400">VĐV {index + 1} · {side.athlete?.fullName || 'Chờ xác định'}</div>
                <div className="mt-2 text-4xl font-bold tabular-nums text-slate-100">{formatMatchScore(side.score)}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                  <span>Lợi thế: <strong className="text-slate-200">{side.advantages || 0}</strong></span>
                  <span>·</span>
                  <span>Lỗi phạt: <strong className="text-slate-200">{side.penalties || 0}</strong></span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <Tag color={MATCH_STATUS_META[initialData?.status]?.color}>{MATCH_STATUS_META[initialData?.status]?.label || initialData?.status}</Tag>
            {initialData?.resultStatus && <Tag color={RESULT_STATUS_META[initialData.resultStatus]?.color}>{RESULT_STATUS_META[initialData.resultStatus]?.label || initialData.resultStatus}</Tag>}
            {winnerName && <span>Người thắng: <strong>{winnerName}</strong></span>}
            {initialData?.winMethod && <span>· {WIN_METHOD_LABELS[initialData.winMethod] || initialData.winMethod}</span>}
          </div>
          <div className="mt-2 text-xs text-slate-500">Dữ liệu tự động làm mới từ bảng điểm sau mỗi thao tác chấm điểm.</div>
        </Card>
      )}
      {matchId && <MatchScoreboardHistory match={initialData || {}} />}
      <Card className="cms-surface" title="Thông tin trận đấu">
        <Row gutter={[20, 2]}>
          <ControlledField name="eventId" control={control} label="Sự kiện" error={errors.eventId?.message} required>
            {(field) => <Select disabled={Boolean(initialData?.team1Id || initialData?.team2Id)} size="large" showSearch optionFilterProp="label" className="w-full" placeholder="Chọn sự kiện" value={field.value || undefined} onChange={(value) => { field.onChange(value); setValue('categoryId', ''); setValue('athlete1Id', ''); setValue('athlete2Id', ''); setValue('fopId', ''); }} options={eventOptions} />}
          </ControlledField>
          <ControlledField name="categoryId" control={control} label="Hạng mục" error={errors.categoryId?.message} required>
            {(field) => <Select disabled={Boolean(initialData?.team1Id || initialData?.team2Id)} size="large" showSearch optionFilterProp="label" className="w-full" placeholder="Chọn hạng mục" value={field.value || undefined} onChange={(value) => { field.onChange(value); setValue('athlete1Id', ''); setValue('athlete2Id', ''); }} options={categoryOptions} />}
          </ControlledField>
          {!initialData?.team1Id && !initialData?.team2Id && <>
          <ControlledField name="athlete1Id" control={control} label="Vận động viên 1" error={errors.athlete1Id?.message}>
            {(field) => <RemoteAthleteSelect eventId={selectedEventId} categoryId={selectedCategoryId} initialOptions={initialAthletes} placeholder="Chờ xác định" value={field.value || undefined} excludeIds={[selectedAthlete2Id || '']} onChange={(value) => field.onChange(value || '')} />}
          </ControlledField>
          <ControlledField name="athlete2Id" control={control} label="Vận động viên 2" error={errors.athlete2Id?.message}>
            {(field) => <RemoteAthleteSelect eventId={selectedEventId} categoryId={selectedCategoryId} initialOptions={initialAthletes} placeholder="Chờ xác định" value={field.value || undefined} excludeIds={[selectedAthlete1Id || '']} onChange={(value) => field.onChange(value || '')} />}
          </ControlledField>
          </>}
          <ControlledField name="matchDate" control={control} label="Thời gian thi đấu" error={errors.matchDate?.message} required>
            {(field) => (
              <DatePicker needConfirm={false}
                showTime={{ format: 'HH:mm' }}
                format="DD/MM/YYYY HH:mm"
                size="large"
                className="w-full"
                placeholder="Chọn thời gian thi đấu"
                value={field.value ? dayjs(field.value) : null}
                onBlur={field.onBlur}
                onChange={(value) => field.onChange(value ? value.format('YYYY-MM-DDTHH:mm') : '')}
              />
            )}
          </ControlledField>
          <ControlledField name="fopId" control={control} label="Sàn / FOP" error={errors.fopId?.message}>
            {(field) => <Select allowClear showSearch optionFilterProp="label" size="large" className="w-full" placeholder="Chọn sàn" value={field.value || undefined} onChange={(value) => field.onChange(value || '')} options={(selectedEvent?.fops || []).map((fop: any) => ({ value: fop.id, label: fop.name }))} />}
          </ControlledField>
          <ControlledField name="matchNumber" control={control} label="Số trận" error={errors.matchNumber?.message}>
            {(field) => <Input {...field} size="large" type="number" min={1} placeholder="1" />}
          </ControlledField>
          <ControlledField name="round" control={control} label="Vòng đấu" error={errors.round?.message}>
            {(field) => <Input {...field} size="large" type="number" min={1} placeholder="1" />}
          </ControlledField>
          <ControlledField name="matchType" control={control} label="Loại trận" error={errors.matchType?.message}>
            {(field) => <Select size="large" className="w-full" value={field.value} onChange={field.onChange} options={matchTypeOptions} />}
          </ControlledField>
          <ControlledField name="status" control={control} label="Trạng thái" error={errors.status?.message}>
            {(field) => <Select size="large" className="w-full" value={field.value} onChange={field.onChange} options={statusOptions} />}
          </ControlledField>
          <ControlledField name="pool" control={control} label="Nhóm / Pool" error={errors.pool?.message}>
            {(field) => <Input {...field} size="large" placeholder="A" />}
          </ControlledField>
          <ControlledField name="notes" control={control} label="Ghi chú" error={errors.notes?.message}>
            {(field) => <Input.TextArea {...field} rows={2} placeholder="Thông tin bổ sung" />}
          </ControlledField>
        </Row>
      </Card>
      <FormActions pending={isSubmitting} label={matchId ? 'Lưu thay đổi' : 'Tạo trận đấu'} cancelHref={returnTo} />
      {correctingResult && <MatchResultCorrection match={initialData} role={currentUser?.role} onClose={() => setCorrectingResult(false)} />}
    </Form>
  );
}

function formatMatchScore(value: unknown) {
  const score = Number(value || 0);
  return Number.isInteger(score) ? String(score) : score.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

function ControlledField({ name, control, label, error, children, required = false }: { name: keyof MatchFormValues; control: any; label: string; error?: string; children: (field: any) => React.ReactElement; required?: boolean }) {
  return (
    <Col xs={24} md={12}>
      <Form.Item label={label} validateStatus={error ? 'error' : undefined} help={error} required={required}>
        <Controller name={name} control={control} render={({ field }) => children(field)} />
      </Form.Item>
    </Col>
  );
}
