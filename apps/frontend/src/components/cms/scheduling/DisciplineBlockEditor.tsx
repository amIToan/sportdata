'use client';

import { useState } from 'react';
import dayjs from 'dayjs';
import { Button, Card, Checkbox, DatePicker, Input, InputNumber, Select, Space } from 'antd';
import { ScheduleConfig, groupLabel, stageLabel, uid } from './schedule-ui';
import { registrationDisciplineKey, registrationDisciplineLabel } from '@/components/RegistrationDisciplines';

function categoryScope(category: any) {
  const age = category.minAge != null && category.maxAge != null ? `${category.minAge}–${category.maxAge} tuổi`
    : category.minAge != null ? `Từ ${category.minAge} tuổi` : category.maxAge != null ? `Đến ${category.maxAge} tuổi` : '';
  return [age, category.beltLevel].filter(Boolean).join(' · ');
}

const compareWeight = (a: any, b: any) => (a.weightKind === 'OPEN' ? 2 : a.maxWeight != null ? 0 : 1)
  - (b.weightKind === 'OPEN' ? 2 : b.maxWeight != null ? 0 : 1)
  || (a.maxWeight ?? a.minWeight ?? Infinity) - (b.maxWeight ?? b.minWeight ?? Infinity) || a.id.localeCompare(b.id);

export function DisciplineBlockEditor({ config, input, planId, onChange, onOpen }: {
  config: ScheduleConfig; input: any; planId?: string; onChange: (config: ScheduleConfig) => void;
  onOpen: (id: string) => void;
}) {
  const [selection, setSelection] = useState<string[]>([]);
  const [discipline, setDiscipline] = useState<string>();
  const [dragged, setDragged] = useState<number>();
  const disciplines = new Map<string, { label: string; categories: any[] }>();
  input.categories.forEach((category: any) => {
    const key = registrationDisciplineKey(category);
    const group = disciplines.get(key) || { label: registrationDisciplineLabel(category), categories: [] };
    group.categories.push(category);
    disciplines.set(key, group);
  });
  const selectedIds = new Set(config.blocks.flatMap((block) => block.categoryIds));
  const unavailable = (category: any) => Boolean(category.unsupported || category.owner && category.owner !== planId);
  const categoriesByGroup = new Map<string, any[]>();
  (disciplines.get(discipline || '')?.categories || []).forEach((category) => {
    categoriesByGroup.set(category.groupKey, [...(categoriesByGroup.get(category.groupKey) || []), category]);
  });
  const addCategories = () => {
    const categories = (disciplines.get(discipline || '')?.categories || [])
      .filter((category) => selection.includes(category.id) && !selectedIds.has(category.id) && !unavailable(category));
    if (!categories.length) return;
    const blocks = config.blocks.map((block) => ({ ...block, categoryIds: [...block.categoryIds] }));
    categories.sort(compareWeight).forEach((category) => {
      const block = blocks.find((item) => item.groupKey === category.groupKey);
      if (block) block.categoryIds.push(category.id);
      else blocks.push({ id: uid(), groupKey: category.groupKey, categoryIds: [category.id] });
    });
    onChange({ ...config, name: config.name === 'Lịch thi đấu' && !config.blocks.length
      ? `Lịch ${disciplines.get(discipline!)!.label}` : config.name, blocks });
    setSelection([]);
  };
  const move = (index: number, target: number) => {
    if (target < 0 || target >= config.blocks.length || index === target) return;
    const blocks = [...config.blocks];
    const [item] = blocks.splice(index, 1);
    blocks.splice(target, 0, item);
    onChange({ ...config, blocks });
  };
  const first = config.windows[0];
  const changeFirst = (changes: Partial<ScheduleConfig['windows'][number]>) => onChange({ ...config,
    timezone: changes.fopId ? input.fops.find((fop: any) => fop.id === changes.fopId)?.timezone || config.timezone : config.timezone,
    windows: [{ ...(first || { id: uid(), localDate: '', fopId: '', startLocalTime: '09:00', endLocalTime: '18:00', enabled: true, breaks: [] }), ...changes }, ...config.windows.slice(1)] });
  return <div className="space-y-4">
    <label className="block">Tên lịch<Input aria-label="Tên lịch" value={config.name} maxLength={200} onChange={(event) => onChange({ ...config, name: event.target.value })} /></label>
    <Space wrap><label>Ngày bắt đầu<DatePicker needConfirm={false} size="large" aria-label="Ngày bắt đầu" className="w-full min-w-48" placeholder="Chọn ngày" format="DD/MM/YYYY" allowClear={false}
      value={first?.localDate ? dayjs(first.localDate) : null} defaultPickerValue={input.days[0] ? dayjs(input.days[0]) : undefined}
      disabledDate={(date) => !input.days.includes(date.format('YYYY-MM-DD'))}
      onChange={(date) => changeFirst({ localDate: date?.format('YYYY-MM-DD') || '' })} /></label>
      <label>Thảm bắt đầu<Select aria-label="Thảm bắt đầu" className="block min-w-48" placeholder="Chọn thảm" value={first?.fopId || undefined} options={input.fops.map((fop: any) => ({ value: fop.id, label: fop.name }))} onChange={(fopId) => changeFirst({ fopId })} /></label></Space>
    {(config.windows.length > 1 || config.earliestStarts.length > 0) && <p className="text-sm text-amber-700">Đổi ngày/thảm đầu sẽ tính lại phần lịch phía sau. Các ngày và mốc đã nhập được giữ để bạn kiểm tra ở bước 2.</p>}
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <p className="mb-4 text-sm text-slate-500">Chọn thể thức trước, sau đó chọn một hoặc nhiều hạng cân / hạng đấu để thêm vào lịch. Có thể thêm nhiều thể thức.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block"><span className="mb-2 block text-sm font-semibold">Thể thức thi đấu</span>
          <Select aria-label="Thêm nội dung thi đấu" className="w-full" size="large" showSearch optionFilterProp="label" placeholder="Chọn thể thức thi đấu" value={discipline}
            onChange={(value) => { setDiscipline(value); setSelection([]); }}
            options={[...disciplines].map(([key, group]) => ({ value: key, label: `${group.label} (${group.categories.length} hạng)` }))} />
        </label>
        <label className="block"><span className="mb-2 block text-sm font-semibold">Hạng cân / hạng đấu</span>
          <Select aria-label="Hạng cân / hạng đấu cần xếp lịch" className="w-full" size="large" mode="multiple" showSearch optionFilterProp="label"
            placeholder={discipline ? 'Chọn một hoặc nhiều hạng đấu' : 'Chọn thể thức trước'} disabled={!discipline} value={selection} onChange={setSelection}
            options={[...categoriesByGroup.values()].map((categories) => ({
              label: [groupLabel(categories[0]), categoryScope(categories[0])].filter(Boolean).join(' · '),
              options: [...categories].sort(compareWeight).map((category) => ({ value: category.id,
                label: `${category.name} · ${category.matchCount} trận${selectedIds.has(category.id) ? ' · Đã thêm' : category.owner && category.owner !== planId ? ' · Đang ở lịch khác' : category.unsupported ? ` · ${category.unsupported}` : ''}`,
                disabled: selectedIds.has(category.id) || unavailable(category),
              })),
            }))} />
        </label>
      </div>
      <Button className="mt-4" disabled={!selection.length} onClick={addCategories}>Thêm nội dung</Button>
    </div>
    {config.blocks.map((block, index) => {
      const categories = input.categories.filter((category: any) => category.groupKey === block.groupKey)
        .sort(compareWeight);
      return <div key={block.id} draggable onDragStart={() => setDragged(index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragged !== undefined) move(dragged, index); setDragged(undefined); }}>
        <Card size="small" title={`${index + 1}. ${[groupLabel(categories[0] || {}), categoryScope(categories[0] || {})].filter(Boolean).join(' · ')}`} extra={<Space wrap>
          <Button aria-label={`Đưa nội dung ${index + 1} lên`} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</Button>
          <Button aria-label={`Đưa nội dung ${index + 1} xuống`} disabled={index === config.blocks.length - 1} onClick={() => move(index, index + 1)}>↓</Button>
          <InputNumber aria-label={`Vị trí nội dung ${index + 1}`} min={1} max={config.blocks.length} value={index + 1} onChange={(value) => value && move(index, value - 1)} />
          <Button danger onClick={() => onChange({ ...config, blocks: config.blocks.filter((_, i) => i !== index) })}>Bỏ nội dung</Button>
        </Space>}><div className="space-y-3">{categories.map((category: any) => <div key={category.id}>
          <Checkbox checked={block.categoryIds.includes(category.id)} disabled={Boolean(category.unsupported) || Boolean(category.owner && category.owner !== planId)} onChange={(event) => onChange({ ...config,
            blocks: config.blocks.map((item) => item.id === block.id ? { ...item, categoryIds: event.target.checked ? [...item.categoryIds, category.id] : item.categoryIds.filter((id) => id !== category.id) } : item) })}>{category.name}</Checkbox>
          <span className="ml-2 text-sm text-slate-500">{category.entryCount} {category.entryUnit} · {category.matchCount} trận thật{category.stages?.[0] && ` · bắt đầu ${stageLabel(category.stages[0].stageKey, category.stages[0].round)}`}</span>
          {category.owner && category.owner !== planId && <Button type="link" onClick={() => onOpen(category.owner)}>Đang ở lịch khác · Mở lịch</Button>}
          {category.unsupported && <p className="mt-1 text-sm text-amber-700">{category.unsupported}</p>}
          {category.draftPlans?.some((draft: any) => draft.id !== planId) && <p className="mt-1 text-sm text-amber-700">Cũng được chọn trong bản nháp: {category.draftPlans.filter((draft: any) => draft.id !== planId).map((draft: any) => draft.name).join(', ')}. Bản nháp chưa giữ chỗ.</p>}
        </div>)}</div></Card>
      </div>;
    })}
    <p className="text-sm text-slate-500">Thứ tự: nội dung → vòng đấu → cân nặng thấp đến cao. Chỉ đổi thứ tự trận trong cùng hạng, vòng và nhánh.</p>
  </div>;
}
