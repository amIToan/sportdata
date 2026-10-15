'use client';

import { useEffect, useRef, useState, type Key } from 'react';
import useSWR from 'swr';
import { Alert, Button, Card, Checkbox, Empty, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Upload } from 'antd';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api, fetcher } from '@/lib/api';
import { certificateSize, defaultCertificateDesign, type CertificateDesign, type CertificateEvent, type CertificateRecipient } from '@/lib/certificate-design';
import { normalizeCertificateImage, openCertificatePdf, renderCertificatePdf } from '@/lib/certificate-import';
import { certificatePrintHtml, printCertificates } from '@/lib/certificate-print';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { CertificateDesignEditor } from './CertificateDesignEditor';
import styles from './EventCertificates.module.css';

type Config = { design: CertificateDesign; backgroundUrl: string | null };
const sample: CertificateRecipient = { id: 'sample', athleteName: 'BÙI KHÔI NGUYÊN', birthDate: '2010-01-01', federation: 'TP.HCM', country: 'Việt Nam', category: '-56KG NAM NỘI DUNG GI - U18', sport: 'Jujitsu', award: 'Huy chương Đồng' };
const message = (error: unknown) => (error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message || (error as Error)?.message || 'Không thể thực hiện thao tác';

export function EventCertificatesTab({ event, canEdit }: { event: CertificateEvent & { id: string }; canEdit: boolean }) {
  const toast = useSportDataToast();
  const endpoint = `/events/${event.id}/certificates`;
  const { data: config, error, mutate } = useSWR<Config>(endpoint, fetcher, { revalidateOnFocus: false });
  const { data: recipients = [], error: recipientsError, isLoading } = useSWR<CertificateRecipient[]>(`${endpoint}/recipients`, fetcher);
  const [design, setDesign] = useState<CertificateDesign | null>(null);
  const [background, setBackground] = useState<string | null>(null);
  const [backgroundError, setBackgroundError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [previewId, setPreviewId] = useState('sample');
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>();
  const [includeBackground, setIncludeBackground] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (config && !initialized.current) { initialized.current = true; setDesign(config.design); }
  }, [config]);
  useEffect(() => () => { void pdfRef.current?.destroy(); }, []);
  useEffect(() => {
    let cancelled = false, url: string | undefined;
    setBackground(null); setBackgroundError(false);
    if (config?.backgroundUrl) {
      void api.get<Blob>(config.backgroundUrl.replace(/^\/api/, ''), { responseType: 'blob' }).then((response) => {
        if (!cancelled) { url = URL.createObjectURL(response.data); setBackground(url); }
      }).catch(() => { if (!cancelled) setBackgroundError(true); });
    }
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [config?.backgroundUrl]);

  const update = (next: CertificateDesign) => setDesign(next);
  const dirty = Boolean(config && design && JSON.stringify(config.design) !== JSON.stringify(design));
  const visible = recipients.filter((item) => (!category || item.category === category) && `${item.athleteName} ${item.federation}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
  const selected = recipients.filter((item) => selectedKeys.includes(item.id));
  const recipient = recipients.find((item) => item.id === previewId) || sample;
  const save = async () => {
    if (!design) return;
    setBusy(true);
    try { const response = await api.patch<Config>(endpoint, { design }); await mutate(response.data, false); toast.success('Đã lưu mẫu giấy chứng nhận.'); }
    catch (error) { toast.error(message(error)); }
    finally { setBusy(false); }
  };
  const upload = async (result: { file: File; width: number; height: number }) => {
    if (result.file.size > 20 * 1024 * 1024) throw new Error('Phôi sau chuyển đổi vượt quá 20 MB. Vui lòng giảm kích thước ảnh.');
    const orientation = result.width > result.height ? 'landscape' : 'portrait';
    const target = certificateSize(orientation);
    if (Math.abs(result.width / result.height / (target.width / target.height) - 1) > 0.03) throw new Error('Phôi không đúng tỷ lệ A4. Vui lòng cắt ảnh hoặc xuất lại PDF đúng khổ A4 trước khi nhập.');
    const form = new FormData(); form.append('file', result.file);
    const response = await api.patch<Config>(`${endpoint}/background`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
    await mutate(response.data, false);
    setDesign((previous) => {
      if (!previous || previous.orientation === orientation) return previous;
      const before = certificateSize(previous.orientation);
      return { ...previous, orientation, elements: previous.elements.map((element) => ({ ...element, x: element.x / before.width * target.width, y: element.y / before.height * target.height, width: element.width / before.width * target.width, height: element.height / before.height * target.height })) };
    });
    toast.success('Đã nhập phôi. Kéo các vùng chữ để căn vị trí rồi lưu mẫu.');
  };
  const importFile = async (file: File) => {
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) { toast.error('Chọn PDF, PNG, JPG hoặc WebP, tối đa 20 MB.'); return; }
    setImporting(true);
    try {
      if (file.type === 'application/pdf') { const doc = await openCertificatePdf(file); pdfRef.current = doc; setPdf(doc); setPdfPage(1); }
      else await upload(await normalizeCertificateImage(file));
    } catch (error) { toast.error(message(error)); }
    finally { setImporting(false); }
  };
  const closePdf = () => { void pdf?.destroy(); pdfRef.current = null; setPdf(null); };
  const print = async (items: CertificateRecipient[]) => {
    if (!design || !items.length) return;
    if (items.length > 200) { toast.error('Mỗi lần in tối đa 200 chứng nhận. Hãy chọn số lượng nhỏ hơn.'); return; }
    setPrinting(true);
    try { await printCertificates(certificatePrintHtml(design, event, items, includeBackground ? background || undefined : undefined)); }
    catch (error) { toast.error(message(error)); }
    finally { setPrinting(false); }
  };

  if (error) return <Alert type="error" title="Không tải được mẫu giấy chứng nhận" action={<Button onClick={() => void mutate()}>Thử lại</Button>} />;
  if (!design) return <Card loading />;

  return <div className="space-y-6">
    <Alert className={styles.notice} type="info" showIcon title="In nội dung lên phôi A4 có sẵn" description="Phôi chỉ dùng để căn vị trí. Khi in, chọn A4, tỷ lệ 100% (kích thước thực), lề Không và tắt đầu/chân trang. In thử một tờ trước khi in hàng loạt." />
    <Card title="Thiết kế giấy chứng nhận" extra={canEdit && <Button type="primary" loading={busy} disabled={!dirty || importing || printing} onClick={() => void save()}>Lưu mẫu</Button>}>
      <div className={styles.toolbar}>
        {canEdit && <>
          <Upload accept="application/pdf,image/png,image/jpeg,image/webp" showUploadList={false} disabled={busy || importing || printing} beforeUpload={(file) => { void importFile(file); return false; }}><Button loading={importing}>Nhập phôi PDF / ảnh</Button></Upload>
          {config?.backgroundUrl && <Popconfirm title="Xóa phôi? Bố cục chữ vẫn được giữ." onConfirm={async () => {
            setBusy(true); try { const response = await api.delete<Config>(`${endpoint}/background`); await mutate(response.data, false); } catch (error) { toast.error(message(error)); } finally { setBusy(false); }
          }}><Button danger disabled={busy || importing || printing}>Xóa phôi</Button></Popconfirm>}
          <Popconfirm title="Áp dụng bố cục chứng nhận theo mẫu? Các vùng chữ hiện tại sẽ được thay thế." onConfirm={() => update({ ...defaultCertificateDesign(), awards: design.awards, issueDate: design.issueDate, issuePlace: design.issuePlace || '', signerTitle: design.signerTitle ?? defaultCertificateDesign().signerTitle, signerName: design.signerName || '' })}><Button disabled={busy || importing || printing}>Áp dụng mẫu chứng nhận</Button></Popconfirm>
        </>}
        <Select aria-label="VĐV xem trước" showSearch optionFilterProp="label" style={{ width: 300, maxWidth: '100%' }} value={previewId} onChange={setPreviewId} options={[{ value: 'sample', label: 'Dữ liệu minh họa' }, ...recipients.map((item) => ({ value: item.id, label: `${item.athleteName} · ${item.category}` }))]} />
      </div>
      {backgroundError && <Alert className={styles.notice} type="error" title="Không tải được phôi. Hãy tải lại trang hoặc nhập lại phôi." />}
      <CertificateDesignEditor design={design} onChange={update} event={event} recipient={recipient} background={background} disabled={!canEdit || busy || importing || printing} />
      <p className={styles.help}>PDF nhiều trang: chọn một trang làm phôi. Phôi được chuyển thành ảnh chất lượng cao và lưu theo sự kiện. Các trường dữ liệu tự thay theo từng VĐV; “Nội dung tự nhập” dùng cho câu chữ, người ký, số chứng nhận hoặc chức danh.</p>
    </Card>
    <Card title="Căn máy in và in chứng nhận">
      <div className={styles.toolbar}>
        <label>Ngày cấp <Input type="date" style={{ width: 170 }} value={design.issueDate} disabled={!canEdit || busy || printing} onChange={(e) => update({ ...design, issueDate: e.target.value })} /></label>
        <label>Địa danh cấp <Input placeholder="Ví dụ: Bắc Ninh" style={{ width: 190 }} maxLength={240} value={design.issuePlace || ''} disabled={!canEdit || busy || printing} onChange={(e) => update({ ...design, issuePlace: e.target.value })} /></label>
        {(['offsetX', 'offsetY'] as const).map((axis) => <label key={axis}>{axis === 'offsetX' ? 'Dịch ngang' : 'Dịch dọc'} (mm) <InputNumber min={-20} max={20} step={0.5} precision={1} value={design[axis]} disabled={!canEdit || busy || printing} onChange={(value) => value !== null && update({ ...design, [axis]: value })} /></label>)}
      </div>
      <div className={styles.toolbar}>
        <label>Chức danh người ký<Input.TextArea style={{ width: 280 }} rows={2} maxLength={240} placeholder={'KT. CHỦ TỊCH\nPHÓ CHỦ TỊCH'} value={design.signerTitle || ''} disabled={!canEdit || busy || printing} onChange={(e) => update({ ...design, signerTitle: e.target.value })} /></label>
        <label>Họ tên người ký<Input style={{ width: 260 }} maxLength={240} placeholder="Nhập người ký của giải đấu" value={design.signerName || ''} disabled={!canEdit || busy || printing} onChange={(e) => update({ ...design, signerName: e.target.value })} /></label>
      </div>
      <p className={styles.help}>Số dương dịch sang phải / xuống dưới; số âm dịch sang trái / lên trên. Huy chương được điền từ kết quả đã công bố. BTC có thể sửa nội dung; nếu chưa có huy chương, mẫu ghi nhận tham gia thi đấu.</p>
      <div className={styles.toolbar}>
        <Checkbox checked={includeBackground} disabled={!background || printing} onChange={(e) => setIncludeBackground(e.target.checked)}>In kèm phôi</Checkbox>
        <Button loading={printing} disabled={busy || importing || !design.elements.length || (includeBackground && !background)} onClick={() => void print([recipient])}>In thử VĐV đang xem</Button>
        {canEdit && <Button type="primary" loading={printing} disabled={busy || importing || !selected.length || !design.elements.length || (includeBackground && !background)} onClick={() => void print(selected)}>In {selected.length || ''} chứng nhận đã chọn</Button>}
      </div>
      {dirty && <Alert type="warning" title="Mẫu có thay đổi chưa lưu. Bản in dùng nội dung đang xem; bấm Lưu mẫu để dùng lại lần sau." />}
    </Card>
    <Card title="Danh sách cấp giấy chứng nhận">
      {recipientsError && <Alert type="error" title="Không tải được danh sách VĐV" />}
      <p className={styles.help}>Mỗi VĐV / hạng đấu là một chứng nhận. Danh sách gồm VĐV của sự kiện và đăng ký đã xác nhận.</p>
      <div className={styles.toolbar}>
        <Input.Search allowClear style={{ width: 300 }} placeholder="Tìm VĐV, đơn vị..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select allowClear style={{ width: 240 }} placeholder="Tất cả hạng đấu" value={category} onChange={setCategory} options={[...new Set(recipients.map((item) => item.category).filter(Boolean))].map((value) => ({ value, label: value }))} />
        {canEdit && <Space wrap><Button disabled={printing || !visible.length} onClick={() => setSelectedKeys(visible.map((item) => item.id))}>Chọn {visible.length} kết quả</Button><Button disabled={printing || !selectedKeys.length} onClick={() => setSelectedKeys([])}>Bỏ chọn</Button><span>{selected.length} đã chọn</span></Space>}
      </div>
      <Table<CertificateRecipient> rowKey="id" loading={isLoading} dataSource={visible} scroll={{ x: 950 }} locale={{ emptyText: <Empty description="Chưa có VĐV phù hợp" /> }} pagination={{ pageSize: 20, showSizeChanger: false }} rowSelection={canEdit ? { selectedRowKeys: selectedKeys, preserveSelectedRowKeys: true, onChange: setSelectedKeys, getCheckboxProps: () => ({ disabled: printing }) } : undefined} columns={[
        { title: 'Vận động viên', dataIndex: 'athleteName', width: 200 },
        { title: 'Đơn vị', dataIndex: 'federation', width: 200 },
        { title: 'Bộ môn / Hạng đấu', render: (_, item) => `${item.sport} · ${item.category}`, width: 220 },
        { title: 'Thành tích', width: 250, render: (_, item) => <div>
          <Input maxLength={500} placeholder="Chưa có huy chương được công bố" value={design.awards[item.id] ?? item.award ?? ''} disabled={!canEdit || busy || printing} onChange={(e) => update({ ...design, awards: { ...design.awards, [item.id]: e.target.value } })} />
          {canEdit && Object.prototype.hasOwnProperty.call(design.awards, item.id) && <Button type="link" size="small" disabled={busy || printing} onClick={() => { const awards = { ...design.awards }; delete awards[item.id]; update({ ...design, awards }); }}>Dùng kết quả tự động</Button>}
        </div> },
        { title: '', width: 100, render: (_, item) => <Button type="link" onClick={() => setPreviewId(item.id)}>Xem mẫu</Button> },
      ]} />
    </Card>
    <Modal title="Chọn trang PDF làm phôi" open={Boolean(pdf)} confirmLoading={importing} closable={!importing} maskClosable={!importing} cancelButtonProps={{ disabled: importing }} onCancel={closePdf} onOk={async () => {
      if (!pdf) return; setImporting(true);
      try { await upload(await renderCertificatePdf(pdf, pdfPage)); closePdf(); } catch (error) { toast.error(message(error)); } finally { setImporting(false); }
    }} okText="Dùng trang này" cancelText="Hủy">
      <p className={styles.help}>PDF có {pdf?.numPages} trang. Chọn trang phôi trống, không chọn bản đã điền nội dung.</p>
      <InputNumber aria-label="Trang PDF" min={1} max={pdf?.numPages || 1} precision={0} value={pdfPage} disabled={importing} onChange={(value) => value !== null && setPdfPage(value)} />
    </Modal>
  </div>;
}
