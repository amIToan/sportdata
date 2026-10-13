'use client';

import { ToastNotice } from '@/components/ToastNotice';

import { useEffect } from 'react';
import { Checkbox, DatePicker, Form, Input, Modal, Progress, Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { ScanText, ShieldAlert } from 'lucide-react';

export type IdentityOcrFields = {
  documentType?: 'CCCD' | 'PASSPORT';
  documentNumber?: string;
  fullName?: string;
  dateOfBirth?: string;
  sex?: string;
  nationality?: string;
  placeOfOrigin?: string;
  address?: string;
  issuedAt?: string;
  expiresAt?: string;
  placeOfBirth?: string;
};

export type IdentityOcrResult = {
  status: 'COMPLETED' | 'FAILED' | 'NOT_CONFIGURED';
  provider: 'FPT_AI' | null;
  confidence: number | null;
  fields: IdentityOcrFields;
  fieldConfidence: Record<string, number>;
  message?: string;
};

type FormValues = Omit<IdentityOcrFields, 'dateOfBirth' | 'issuedAt' | 'expiresAt'> & {
  dateOfBirth?: dayjs.Dayjs;
  issuedAt?: dayjs.Dayjs;
  expiresAt?: dayjs.Dayjs;
  applyToProfile?: boolean;
};

export function IdentityOcrReviewModal({
  open,
  result,
  loading,
  applyLabel = 'Dùng họ tên, ngày sinh và giới tính này cho hồ sơ',
  onCancel,
  onConfirm,
}: {
  open: boolean;
  result?: IdentityOcrResult;
  loading?: boolean;
  applyLabel?: string;
  onCancel: () => void;
  onConfirm: (fields: IdentityOcrFields, applyToProfile: boolean) => void | Promise<void>;
}) {
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    if (!open || !result) return;
    form.setFieldsValue({
      ...result.fields,
      dateOfBirth: result.fields.dateOfBirth ? dayjs(result.fields.dateOfBirth) : undefined,
      issuedAt: result.fields.issuedAt ? dayjs(result.fields.issuedAt) : undefined,
      expiresAt: result.fields.expiresAt ? dayjs(result.fields.expiresAt) : undefined,
      applyToProfile: true,
    });
  }, [form, open, result]);

  const confidence = result?.confidence === null || result?.confidence === undefined
    ? null
    : Math.round(result.confidence * 100);

  const submit = async () => {
    const values = await form.validateFields();
    await onConfirm({
      documentType: result?.fields.documentType,
      documentNumber: values.documentNumber?.trim(),
      fullName: values.fullName?.trim(),
      dateOfBirth: values.dateOfBirth?.format('YYYY-MM-DD'),
      sex: values.sex,
      nationality: values.nationality?.trim(),
      placeOfOrigin: values.placeOfOrigin?.trim(),
      address: values.address?.trim(),
      issuedAt: values.issuedAt?.format('YYYY-MM-DD'),
      expiresAt: values.expiresAt?.format('YYYY-MM-DD'),
      placeOfBirth: values.placeOfBirth?.trim(),
    }, Boolean(values.applyToProfile));
  };

  return (
    <Modal
      open={open}
      centered
      width={860}
      title={<span className="flex items-center gap-2"><ScanText className="h-5 w-5 text-sky-500" /> Kiểm tra thông tin đọc từ giấy tờ</span>}
      okText="Tôi xác nhận thông tin đúng"
      cancelText="Kiểm tra lại ảnh"
      confirmLoading={loading}
      onOk={() => void submit()}
      onCancel={onCancel}
      destroyOnHidden
    >
      <ToastNotice
        className="mb-5"
        showIcon
        icon={<ShieldAlert className="h-5 w-5" />}
        type="warning"
        message="OCR chỉ đọc chữ, chưa xác thực thật/giả"
        description="Vui lòng đối chiếu với ảnh gốc và sửa thông tin nếu cần. CMS hoặc eKYC/NFC sẽ thực hiện bước xác thực cuối cùng."
      />
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <Tag color="blue">{result?.fields.documentType === 'PASSPORT' ? 'Hộ chiếu' : 'CCCD'}</Tag>
        <span className="text-sm text-slate-600">Nhà cung cấp: {result?.provider || 'Chưa cấu hình'}</span>
        {confidence !== null && <div className="ml-auto flex min-w-44 items-center gap-2 text-sm text-slate-600"><span>Độ tin cậy</span><Progress percent={confidence} size="small" className="!mb-0 flex-1" /></div>}
      </div>
      <Form form={form} layout="vertical" requiredMark="optional">
        <div className="grid gap-x-5 md:grid-cols-2">
          <Form.Item label="Số giấy tờ" name="documentNumber" rules={[{ required: true, message: 'Vui lòng kiểm tra số giấy tờ' }]}><Input /></Form.Item>
          <Form.Item label="Họ và tên" name="fullName" rules={[{ required: true, message: 'Vui lòng kiểm tra họ tên' }]}><Input /></Form.Item>
          <Form.Item label="Ngày sinh" name="dateOfBirth"><DatePicker needConfirm={false} size="large" className="w-full" format="DD/MM/YYYY" disabledDate={(date) => date.isAfter(dayjs(), 'day')} /></Form.Item>
          <Form.Item label="Giới tính" name="sex"><Select allowClear options={[{ value: 'Nam', label: 'Nam' }, { value: 'Nữ', label: 'Nữ' }, { value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} /></Form.Item>
          <Form.Item label="Quốc tịch" name="nationality"><Input /></Form.Item>
          <Form.Item label="Quê quán / nơi sinh" name="placeOfOrigin"><Input /></Form.Item>
          <Form.Item className="md:col-span-2" label="Nơi thường trú / địa chỉ" name="address"><Input /></Form.Item>
          <Form.Item label="Ngày cấp" name="issuedAt"><DatePicker needConfirm={false} size="large" className="w-full" format="DD/MM/YYYY" /></Form.Item>
          <Form.Item label="Ngày hết hạn" name="expiresAt"><DatePicker needConfirm={false} size="large" className="w-full" format="DD/MM/YYYY" /></Form.Item>
        </div>
        <Form.Item name="applyToProfile" valuePropName="checked" className="!mb-0">
          <Checkbox>{applyLabel}</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}
