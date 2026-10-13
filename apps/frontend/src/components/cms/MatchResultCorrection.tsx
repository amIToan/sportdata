'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Table } from 'antd';
import { api, fetcher } from '@/lib/api';
import { RESULT_ACTION_LABELS, RESULT_STATUS_META, WIN_METHOD_LABELS } from '@/lib/vi-labels';
import { formatDateTime } from '@/lib/utils';
import { pointsWinnerSide } from '@/lib/result-correction';

type Preview = { token: string; sourceVersion: number; changes: Array<{ id: string; matchNumber?: number; categoryName: string; before: any; after: any }> };
const requestError = (error: any) => {
  const message = error.response?.data?.message;
  return Array.isArray(message) ? message.join('. ') : message || 'Không thể cập nhật kết quả. Hãy tải lại và thử lại.';
};
const pairing = (match: any) => [match?.athlete1?.fullName || match?.team1?.name || 'Chờ xác định', match?.athlete2?.fullName || match?.team2?.name || 'Chờ xác định'].join(' — ');

export function MatchResultCorrection({ match, role, onClose }: { match: any; role?: string; onClose: () => void }) {
  const [form] = Form.useForm();
  const initialized = useRef(false);
  const { data, error: loadError, mutate } = useSWR<any>(`/results/matches/${match.id}`, fetcher);
  const { mutate: refresh } = useSWRConfig();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dirty, setDirty] = useState(false);
  const canCorrect = role === 'ADMIN' || role === 'GAMES_ADMIN';
  const state = data?.resultStatus || match.resultStatus;
  const needsReopen = ['APPROVED', 'PUBLISHED', 'LOCKED'].includes(state);
  const athletes = [match.athlete1, match.athlete2].filter(Boolean);
  const winMethod = Form.useWatch('winMethod', form);
  const syncPointsWinner = (values: any) => {
    if (values.winMethod !== 'POINTS') return values;
    const side = pointsWinnerSide(values);
    const winnerId = side ? match[`athlete${side}Id`] : undefined;
    form.setFieldValue('winnerId', winnerId);
    return { ...values, winnerId };
  };

  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    const side = data.winMethod === 'POINTS' ? pointsWinnerSide(data) : null;
    const winnerId = data.winMethod === 'POINTS' ? side ? data[`athlete${side}Id`] : undefined : data.winnerId || undefined;
    setDirty(winnerId !== (data.winnerId || undefined));
    form.setFieldsValue({
      athlete1Score: data.athlete1Score, athlete2Score: data.athlete2Score,
      athlete1Advantages: data.athlete1Advantages, athlete2Advantages: data.athlete2Advantages,
      athlete1Penalties: data.athlete1Penalties, athlete2Penalties: data.athlete2Penalties,
      winnerId, winMethod: data.winMethod || 'POINTS', reason: '',
    });
  }, [data, form]);

  const refreshRelated = async () => {
    await refresh((key) => {
      const url = typeof key === 'string' ? key : Array.isArray(key) ? key[0] : null;
      return typeof url === 'string' && (url.startsWith('/matches') || url.startsWith('/results/matches')
        || url.startsWith(`/scheduling/events/${match.eventId}`) || url.startsWith(`/events/${match.eventId}`));
    });
  };
  const calculate = async () => {
    try {
      syncPointsWinner(form.getFieldsValue());
      const values = await form.validateFields();
      setBusy('preview'); setError(''); setSuccess(''); setPreview(undefined);
      const response = await api.post<Preview>(`/results/matches/${match.id}/correction-preview`, { ...values, expectedVersion: data.resultVersion });
      setPreview(response.data);
    } catch (error: any) { if (!error.errorFields) setError(requestError(error)); if (error.response?.status === 409) await mutate(); }
    finally { setBusy(''); }
  };
  const save = async () => {
    if (!preview || busy) return;
    try {
      const values = await form.validateFields();
      setBusy('save'); setError('');
      const response = await api.post(`/results/matches/${match.id}/enter`, { ...values, expectedVersion: preview.sourceVersion, progressionToken: preview.token });
      await mutate(response.data, { revalidate: false });
      form.setFieldsValue({ ...response.data, reason: values.reason });
      setDirty(false);
      setPreview(undefined);
      setSuccess('Đã lưu hiệu chỉnh và cập nhật cặp đấu. Kết quả đang chờ trọng tài xác nhận lại.');
      await refreshRelated();
    } catch (error: any) { setPreview(undefined); setError(requestError(error)); await mutate(); }
    finally { setBusy(''); }
  };
  const workflow = async (action: 'reopen' | 'referee-confirm') => {
    try {
      const reason = form.getFieldValue('reason')?.trim();
      if (action === 'reopen' && !reason) { await form.validateFields(['reason']); return; }
      setBusy(action); setError(''); setSuccess(''); setPreview(undefined);
      const response = await api.post(`/results/matches/${match.id}/${action}`, { expectedVersion: data.resultVersion, reason });
      await mutate(response.data, { revalidate: false });
      setSuccess(action === 'reopen' ? 'Đã mở lại. Chỉnh kết quả rồi tính lại cặp đấu trước khi lưu.' : 'Trọng tài đã xác nhận lại kết quả.');
      await refreshRelated();
    } catch (error: any) { if (!error.errorFields) setError(requestError(error)); }
    finally { setBusy(''); }
  };

  return <Modal open title={`Hiệu chỉnh kết quả · Trận #${match.matchNumber || '—'}`} width={960} footer={null} onCancel={() => { if (!busy) onClose(); }} closable={!busy} maskClosable={!busy}>
    <Space direction="vertical" size="large" className="w-full">
      <Alert type="info" showIcon title={RESULT_STATUS_META[state]?.label || state} description="Nhập kết quả đúng và lý do, tính lại để xem ảnh hưởng tới nhánh thắng/thua, rồi xác nhận lưu. Trận đã bắt đầu hoặc có kết quả ở phía sau sẽ chặn đổi VĐV." />
      {(loadError || error) && <Alert type="error" showIcon title={error || 'Không thể tải kết quả trận đấu.'} />}
      {success && <Alert type="success" showIcon title={success} />}
      <Form form={form} layout="vertical" disabled={!canCorrect || Boolean(busy) || !data || Boolean(loadError)} onValuesChange={(_, values) => { syncPointsWinner(values); setDirty(true); setPreview(undefined); setSuccess(''); }}>
        <Row gutter={16}>{([1, 2] as const).map((side) => <Col span={12} key={side}>
          <strong>{athletes[side - 1]?.fullName || `VĐV ${side}`}</strong>
          <Form.Item name={`athlete${side}Score`} label="Điểm" rules={[{ required: true }]}><InputNumber min={0} max={match.resultData?.scoreboard ? 50 : undefined} className="!w-full" /></Form.Item>
          <Form.Item name={`athlete${side}Advantages`} label="Lợi thế" rules={[{ required: true }]}><InputNumber min={0} precision={0} className="!w-full" /></Form.Item>
          <Form.Item name={`athlete${side}Penalties`} label="Phạt" rules={[{ required: true }]}><InputNumber min={0} max={match.resultData?.scoreboard ? 4 : undefined} precision={0} className="!w-full" /></Form.Item>
        </Col>)}</Row>
        <Row gutter={16}><Col span={12}><Form.Item name="winnerId" label="Vận động viên thắng" extra={winMethod === 'POINTS' ? 'Tự tính theo điểm, lợi thế, rồi số lần phạt. Nếu hòa hoàn toàn, chọn Quyết định trọng tài.' : undefined} rules={[{ required: true, message: winMethod === 'POINTS' ? 'Chưa xác định được người thắng. Kiểm tra điểm hoặc chọn Quyết định trọng tài khi hòa.' : 'Chọn VĐV thắng' }]}><Select disabled={winMethod === 'POINTS'} options={athletes.map((athlete) => ({ value: athlete.id, label: athlete.fullName }))} /></Form.Item></Col>
          <Col span={12}><Form.Item name="winMethod" label="Phương thức thắng" rules={[{ required: true }]}><Select options={Object.entries(WIN_METHOD_LABELS).map(([value, label]) => ({ value, label }))} /></Form.Item></Col></Row>
        <Form.Item name="reason" label="Lý do hiệu chỉnh" rules={[{ required: true, whitespace: true, message: 'Nhập lý do hiệu chỉnh' }]}><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
        <Space wrap>
          {needsReopen ? role === 'ADMIN' ? <Button danger loading={busy === 'reopen'} onClick={() => void workflow('reopen')}>Mở lại để hiệu chỉnh</Button> : <span>Kết quả đã phê duyệt/công bố/khóa cần quản trị viên mở lại.</span>
            : <><Button aria-label="Tính lại cặp đấu" disabled={Boolean(busy)} loading={busy === 'preview'} onClick={() => void calculate()}>Tính lại cặp đấu</Button><Button aria-label="Lưu kết quả & cập nhật cặp đấu" type="primary" loading={busy === 'save'} disabled={!preview || Boolean(busy)} onClick={() => void save()}>Lưu kết quả & cập nhật cặp đấu</Button></>}
        </Space>
      </Form>
      {preview && <div><Alert className="mb-3" type="info" title={`Người thắng sau khi lưu: ${athletes.find((athlete) => athlete.id === form.getFieldValue('winnerId'))?.fullName || '—'}`} description={`Tỷ số: ${form.getFieldValue('athlete1Score')} – ${form.getFieldValue('athlete2Score')}`} /><h3 className="mb-3 font-semibold">Cặp đấu sau hiệu chỉnh</h3>{preview.changes.length ? <Table rowKey="id" size="small" pagination={false} scroll={{ x: 650 }} dataSource={preview.changes} columns={[
        { title: 'Trận', key: 'match', render: (_, item) => `#${item.matchNumber || '—'} · ${item.categoryName}` },
        { title: 'Hiện tại', key: 'before', render: (_, item) => pairing(item.before) },
        { title: 'Sau khi lưu', key: 'after', render: (_, item) => pairing(item.after) },
      ]} /> : <Alert type="info" title="Cặp đấu không thay đổi. Chỉ cập nhật kết quả của trận này." />}</div>}
      {state === 'ENTERED' && canCorrect && <Button aria-label="Trọng tài xác nhận lại kết quả đã lưu" type="primary" disabled={dirty || Boolean(busy) || Boolean(preview) || !data || Boolean(loadError)} loading={busy === 'referee-confirm'} onClick={() => void workflow('referee-confirm')}>Trọng tài xác nhận lại kết quả đã lưu</Button>}
      {(data?.resultRevisions || []).some((revision: any) => revision.reason) && <div><h3 className="mb-3 font-semibold">Lịch sử hiệu chỉnh kết quả</h3><Table size="small" rowKey="id" pagination={{ pageSize: 5, hideOnSinglePage: true }} dataSource={(data?.resultRevisions || []).filter((revision: any) => revision.reason)} columns={[
        { title: 'Thời điểm', dataIndex: 'createdAt', render: (value) => formatDateTime(value) },
        { title: 'Thao tác', dataIndex: 'action', render: (value) => RESULT_ACTION_LABELS[value] || 'Hiệu chỉnh kết quả' },
        { title: 'Lý do', dataIndex: 'reason' },
      ]} /></div>}
    </Space>
  </Modal>;
}
