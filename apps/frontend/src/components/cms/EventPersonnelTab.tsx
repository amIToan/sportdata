'use client';

import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Alert, Button, Card, Empty, Modal, Segmented, Select, Space, Spin, Tag, Typography } from 'antd';
import { Plus } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { AccountAvatar, AccountProfileModal, ProfileCompletionTags, type SportDataAccount } from './SportDataAccountProfile';
import { EventParticipationTickets } from './EventParticipationTickets';
import { NonAthleteEventRegistration } from '../NonAthleteEventRegistration';
import type { ParticipationRole } from '@/lib/event-participation';

const roles = [{ value: 'REFEREE', label: 'Trọng tài' }, { value: 'COACH', label: 'Huấn luyện viên' }, { value: 'TEAM_LEADER', label: 'Trưởng đoàn' }];

export function EventPersonnelTab({ event, canOperate }: { event: any; canOperate: boolean }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('REFEREE');
  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<SportDataAccount>();
  const [accountId, setAccountId] = useState<string>();
  const [federationId, setFederationId] = useState<string>();
  const [viewing, setViewing] = useState<SportDataAccount>();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('EXISTING');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(keyword.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);
  const toast = useSportDataToast();
  const { mutate } = useSWRConfig();
  const params = new URLSearchParams({ accountGroup: 'PERSONNEL', accountType: role, isActive: 'true', limit: '50', page: '1', search });
  const accounts = useSWR<{ items: SportDataAccount[]; total: number }>(open ? `/participant-auth/admin/accounts?${params}` : null, fetcher);
  const units = useSWR<any[]>(open ? '/federations' : null, fetcher);
  const availableUnits = (units.data || []).filter((unit) => !event.participatingFederations?.length || event.participatingFederations.some((item: any) => item.id === unit.id));
  const unitValid = !federationId || availableUnits.some((unit) => unit.id === federationId);
  const save = async () => {
    if (!accountId) return;
    setSaving(true);
    try {
      const response = await api.post('/participant-auth/admin/event-participations', { eventId: event.id, accountId, role, federationId });
      setOpen(false);
      await mutate(`/participant-auth/admin/event-participations?eventId=${encodeURIComponent(event.id)}`);
      toast.success(response.data.emailQueued ? 'Đã duyệt, cấp vé và đưa email vào hàng đợi gửi.' : 'Đã đăng ký. Hồ sơ chưa đủ điều kiện tự duyệt, cần bổ sung hoặc xác thực giấy tờ.');
    } catch (error: any) { toast.error(error.response?.data?.message || 'Không thể đăng ký nhân sự'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-5">
    <Card><div className="flex flex-wrap items-center justify-between gap-3">
      <div><Typography.Title level={5}>Danh sách Quản lý</Typography.Title><Typography.Text type="secondary">Trọng tài, huấn luyện viên và trưởng đoàn tham gia sự kiện.</Typography.Text></div>
      {canOperate && <Button type="primary" icon={<Plus size={16} />} onClick={() => { setAccountId(undefined); setSelected(undefined); setFederationId(undefined); setKeyword(''); setSearch(''); setOpen(true); }}>Đăng ký nhân sự</Button>}
    </div></Card>
    <EventParticipationTickets eventId={event.id} canOperate={canOperate} />
    <Modal title="Đăng ký nhân sự" width={800} open={open} footer={mode === 'NEW' ? null : undefined} onCancel={() => { if (!saving) setOpen(false); }} onOk={() => void save()} okText="Xác nhận đăng ký" cancelText="Hủy" confirmLoading={saving} okButtonProps={{ disabled: !accountId || !unitValid || units.isLoading || Boolean(units.error) || (role === 'TEAM_LEADER' && !federationId) }}>
      <div className="space-y-4">
        <Typography.Text type="secondary" className="!block">Chọn vai trò và hồ sơ để thêm vào {event.name}.</Typography.Text>
        <div><label className="mb-2 block font-semibold">1. Vai trò tham gia</label><Segmented block disabled={saving} value={role} options={roles} onChange={(value) => { setRole(String(value)); setAccountId(undefined); setSelected(undefined); setFederationId(undefined); setKeyword(''); setSearch(''); }} /></div>
        <Segmented block disabled={saving} value={mode} options={[{ value: 'EXISTING', label: 'Nhân sự đã có' }, { value: 'NEW', label: 'Đăng ký nhân sự mới' }]} onChange={(value) => setMode(String(value))} />
        {mode === 'NEW' ? <NonAthleteEventRegistration key={`${event.id}:${role}`} cms embedded eventId={event.id} role={role as ParticipationRole} onBusy={setSaving} onCreated={() => { setOpen(false); void mutate(`/participant-auth/admin/event-participations?eventId=${encodeURIComponent(event.id)}`); }} /> : <>
        {accounts.error && <Alert type="error" title="Không tải được nhân sự" action={<Button onClick={() => void accounts.mutate()}>Thử lại</Button>} />}
        <div><label htmlFor="event-personnel-picker" className="mb-2 block font-semibold">2. Chọn nhân sự</label>
          <Select id="event-personnel-picker" size="large" disabled={saving} allowClear showSearch filterOption={false} onSearch={setKeyword} className="w-full" placeholder="Nhập tên, email hoặc số điện thoại để tìm…" loading={accounts.isLoading} value={accountId}
            notFoundContent={accounts.isLoading || keyword.trim() !== search ? <Spin size="small" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có nhân sự phù hợp với vai trò và từ khóa." />}
            onChange={(id) => { const person = accounts.data?.items.find((item) => item.id === id); setAccountId(id); setSelected(person); setFederationId(person?.federation?.id); }}
            options={[...(accounts.data?.items || []), ...(selected && !accounts.data?.items.some((item) => item.id === selected.id) ? [selected] : [])].map((item) => ({ value: item.id, label: `${item.displayName} · ${item.email}` }))} />
          {(accounts.data?.total || 0) > 50 && <Typography.Text type="secondary" className="!mt-2 !block !text-xs">Đang hiển thị 50 kết quả. Nhập thêm từ khóa để tìm đúng người.</Typography.Text>}
        </div>
        {selected && <div className="rounded-xl border border-slate-500/20 p-4">
          <div className="flex items-start gap-3"><AccountAvatar account={selected} size={48} /><div className="min-w-0 flex-1"><strong>{selected.displayName}</strong><Typography.Text type="secondary" className="block break-all text-sm">{selected.email}</Typography.Text>{selected.phone && <Typography.Text type="secondary" className="block text-sm">{selected.phone}</Typography.Text>}</div><Button type="link" onClick={() => setViewing(selected)}>Chi tiết</Button></div>
          <Space wrap className="mt-3"><Tag color={selected.verificationStatus === 'VERIFIED' ? 'success' : 'warning'}>{selected.verificationStatus === 'VERIFIED' ? 'Tài khoản đã duyệt' : 'Tài khoản chưa duyệt'}</Tag><ProfileCompletionTags account={selected} /></Space>
        </div>}
        <div><label htmlFor="event-personnel-unit" className="mb-2 block font-semibold">3. Đơn vị đại diện{role === 'TEAM_LEADER' ? ' *' : ' (không bắt buộc)'}</label><Select id="event-personnel-unit" disabled={saving} loading={units.isLoading} allowClear showSearch optionFilterProp="label" className="w-full" placeholder="Chọn liên đoàn / CLB / đơn vị" value={federationId} onChange={setFederationId} options={availableUnits.map((unit) => ({ value: unit.id, label: unit.name }))} /></div>
        {(!unitValid || units.error) && <Alert type="warning" showIcon title={units.error ? 'Không tải được đơn vị. Vui lòng thử lại.' : 'Đơn vị trong hồ sơ chưa thuộc sự kiện. Chọn lại đơn vị đại diện.'} action={units.error ? <Button onClick={() => void units.mutate()}>Thử lại</Button> : undefined} />}
        <Alert type="info" showIcon title="Cấp vé sau khi đăng ký" description="Hệ thống tự duyệt và gửi vé qua email khi hồ sơ đủ điều kiện. Hồ sơ cần bổ sung hoặc xác thực giấy tờ sẽ được lưu ở trạng thái chờ duyệt." />
        </>}
      </div>
    </Modal>
    <AccountProfileModal account={viewing} open={Boolean(viewing)} onClose={() => setViewing(undefined)} />
  </div>;
}
