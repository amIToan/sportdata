'use client';

import Link from 'next/link';
import { Button, Select } from 'antd';
import { Plus, Trash2, Users, Wallet } from 'lucide-react';

export type RegistrationCategory = {
  id: string;
  name: string;
  sportId: string;
  discipline?: string | null;
  uniform?: string | null;
  sport?: { name: string } | null;
};

export type DisciplineEntry = { disciplineKey?: string; categoryId?: string; partnerKey?: string };
export type ExistingDisciplineRegistration = {
  ticketCode: string;
  categoryId: string;
  status: string;
  paymentStatus: string;
  feeAmount: number;
};

function disciplineKey(category: RegistrationCategory): string {
  const discipline = category.discipline === 'FULL_CONTACT' ? 'CONTACT' : category.discipline;
  const uniform = discipline === 'NEWAZA' ? category.uniform || 'GI' : '';
  return `${category.sportId}:${discipline || 'DEFAULT'}:${uniform}`;
}

function disciplineLabel(category: RegistrationCategory): string {
  const labels: Record<string, string> = {
    FIGHTING: 'Fighting System',
    DUO: 'Duo System',
    SHOW: 'Show System',
    CONTACT: 'Contact Ju-Jitsu / Full Contact',
    FULL_CONTACT: 'Contact Ju-Jitsu / Full Contact',
    NEWAZA: category.uniform === 'NO_GI' ? 'No-Gi Jiu-Jitsu' : 'Gi Jiu-Jitsu',
  };
  const label = labels[category.discipline || ''] || category.discipline;
  return [category.sport?.name, label].filter(Boolean).join(' · ') || 'Nội dung thi đấu';
}

export function registrationCategoryLabel(category: RegistrationCategory): string {
  return `${disciplineLabel(category)} · ${category.name}`;
}

export function RegistrationDisciplines({ categories, entries, existingRegistrations, onChange, partners = [], onAddPartner, declarantName }: {
  declarantName?: string;
  partners?: { key: string; name: string }[];
  onAddPartner?: (entryIndex: number, source: 'NEW' | 'DATABASE') => void;
  categories: RegistrationCategory[];
  entries: DisciplineEntry[];
  existingRegistrations: ExistingDisciplineRegistration[];
  onChange: (entries: DisciplineEntry[]) => void;
}) {
  const groups = new Map<string, { label: string; categories: RegistrationCategory[] }>();
  categories.forEach((category) => {
    const key = disciplineKey(category);
    const group = groups.get(key) || { label: disciplineLabel(category), categories: [] };
    group.categories.push(category);
    groups.set(key, group);
  });
  const registeredKeys = new Set(existingRegistrations.flatMap((registration) => {
    const category = categories.find((item) => item.id === registration.categoryId);
    return category ? [disciplineKey(category)] : [];
  }));
  const selectedKeys = new Set(entries.map((entry) => entry.disciplineKey).filter(Boolean));
  const updateEntry = (index: number, entry: DisciplineEntry) => {
    onChange(entries.map((current, entryIndex) => entryIndex === index ? entry : current));
  };

  return (
    <div className="registration-disciplines mt-6 border-t pt-6">
      <h3 className="font-bold">Nội dung thi đấu *</h3>
      <p className="mb-4 mt-2 text-sm text-slate-500">Có thể đăng ký nhiều nội dung. Mỗi nội dung chọn một hạng cân / hạng đấu. Duo và Show chọn hạng thi đấu do ban tổ chức quy định.</p>
      {existingRegistrations.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-sm font-semibold">Các nội dung đã đăng ký</p>
          {existingRegistrations.map((registration) => {
            const category = categories.find((item) => item.id === registration.categoryId);
            const payment = registration.paymentStatus === 'PENDING' && registration.feeAmount > 0;
            return (
              <div key={registration.ticketCode} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-500/5 p-3 text-sm">
                <span>{category ? registrationCategoryLabel(category) : 'Hạng đấu đã đăng ký'}</span>
                <Link href={`/tickets/${encodeURIComponent(registration.ticketCode)}${payment ? '?payment=1' : ''}`}>
                  <Button size="small">{payment ? 'Tiếp tục thanh toán' : 'Xem trạng thái / thẻ'}</Button>
                </Link>
              </div>
            );
          })}
        </div>
      )}
      <div className="space-y-3">
        {entries.map((entry, index) => (
          <div key={index} className="registration-discipline-entry rounded-xl border p-4">
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold">Nội dung {index + 1} *</label>
                <Select className="w-full" size="large" showSearch optionFilterProp="label" placeholder="Chọn nội dung thi đấu" value={entry.disciplineKey}
                  onChange={(value) => updateEntry(index, { disciplineKey: value })}
                  options={[...groups].map(([key, group]) => ({ value: key, label: group.label,
                    disabled: registeredKeys.has(key) || (selectedKeys.has(key) && entry.disciplineKey !== key) }))} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold">Hạng cân / hạng đấu *</label>
                <Select className="w-full" size="large" showSearch optionFilterProp="label" placeholder="Chọn hạng thi đấu" disabled={!entry.disciplineKey} value={entry.categoryId}
                  onChange={(value) => updateEntry(index, { ...entry, categoryId: value })}
                  options={(groups.get(entry.disciplineKey || '')?.categories || []).map((category) => ({ value: category.id, label: category.name }))} />
              </div>
            </div>
            <Button danger size="large" aria-label={`Xóa nội dung ${index + 1}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(entries.filter((_, entryIndex) => entryIndex !== index))} />
          </div>
          {['DUO', 'SHOW'].includes(categories.find((category) => category.id === entry.categoryId)?.discipline || '') && (
            <div className="registration-tone-panel mt-4 rounded-xl border p-4">
              <div className="registration-tone-title mb-3 flex items-center gap-2 font-semibold"><Users size={18} /> Cặp thi đấu · 2 VĐV</div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm"><strong>{declarantName || 'VĐV khai báo'}</strong><span>+</span><strong>{partners.find((partner) => partner.key === entry.partnerKey)?.name || 'Chưa chọn đồng đội'}</strong></div>
              <label className="mb-2 block text-sm font-medium">Đồng đội của bạn *</label>
              <Select className="w-full" size="large" placeholder="Chọn VĐV trong hồ sơ đăng ký" value={entry.partnerKey}
                onChange={(partnerKey) => updateEntry(index, { ...entry, partnerKey })}
                options={partners.map((partner) => ({ value: partner.key, label: partner.name }))} />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button icon={<Plus size={15} />} onClick={() => onAddPartner?.(index, 'NEW')}>Khai báo đồng đội mới</Button>
                <Button icon={<Users size={15} />} onClick={() => onAddPartner?.(index, 'DATABASE')}>Chọn hồ sơ đã lưu</Button>
              </div>
              <p className="registration-muted mb-0 mt-3 flex items-start gap-2 text-sm"><Wallet size={16} className="mt-0.5 shrink-0" /> VĐV khai báo nội dung này chịu lệ phí. Đồng đội không phải đóng thêm cho cặp này.</p>
            </div>
          )}
          </div>
        ))}
      </div>
      <Button className="mt-3" icon={<Plus className="h-4 w-4" />} disabled={entries.some((entry) => !entry.categoryId) || ![...groups.keys()].some((key) => !registeredKeys.has(key) && !selectedKeys.has(key))}
        onClick={() => onChange([...entries, {}])}>Thêm nội dung thi đấu</Button>
    </div>
  );
}
