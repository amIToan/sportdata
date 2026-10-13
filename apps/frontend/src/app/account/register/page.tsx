'use client';

import dayjs from 'dayjs';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Button, Card, Col, DatePicker, Form, Input, Row, Select } from 'antd';
import { UserPlus } from 'lucide-react';
import { fetcher } from '@/lib/api';
import { useSportDataToast } from '@/hooks/useSportDataToast';
import { participantApi, participantError, setParticipantSession } from '@/lib/participant-auth';
import { vietnamCountryId } from '@/lib/countries';
import { capitalizeRegistrationName } from '@/lib/registration-names';
import { sportDataAccountTypeOptions } from '@/lib/sportdata-account-types';

type Country = { id: string; code: string; name: string };
type Federation = { id: string; name: string; countryId: string };
export default function ParticipantRegisterPage() {
  const router = useRouter();
  const toast = useSportDataToast();
  const [form] = Form.useForm();
  const identityType = Form.useWatch('identityType', form);
  const countryId = Form.useWatch('countryId', form);
  const [loading, setLoading] = useState(false);
  const { data: countries = [] } = useSWR<Country[]>('/countries', fetcher);
  const { data: federations = [] } = useSWR<Federation[]>('/federations', fetcher);

  useEffect(() => {
    const defaultCountryId = vietnamCountryId(countries);
    if (defaultCountryId && !form.getFieldValue('countryId')) {
      form.setFieldValue('countryId', defaultCountryId);
    }
  }, [countries, form]);

  const submit = async (values: any) => {
    setLoading(true);
    try {
      const { accountType, ...details } = values;
      const payload = {
        ...details,
        accountTypes: [accountType],
        displayName: capitalizeRegistrationName(values.displayName),
        birthDate: values.birthDate.format('YYYY-MM-DD'),
      };
      const { data } = await participantApi.post('/participant-auth/register', payload);
      setParticipantSession(data.accessToken, data.account);
      toast.success('Tạo tài khoản SportData thành công.');
      router.replace('/account');
    } catch (requestError) {
      toast.error(participantError(requestError, 'Không thể tạo tài khoản'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-[calc(100vh-64px)] justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-5xl">
      <Card className="w-full" title="Đăng ký tài khoản SportData">
        <p className="mb-6 text-sm text-slate-400">Tài khoản cá nhân dùng chung cho mọi sự kiện và bộ môn trên nền tảng.</p>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ identityType: 'CCCD', accountType: 'ATHLETE' }} onFinish={submit}>
          <Row gutter={16}>
            <Col xs={24}>
              <Form.Item name="accountType" label="Loại tài khoản" rules={[{ required: true, message: 'Chọn một loại tài khoản' }]} extra="Mỗi tài khoản chỉ được chọn một loại.">
                <Select size="large" options={[...sportDataAccountTypeOptions]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="identityType" label="Loại giấy tờ" rules={[{ required: true }]}>
                <Select size="large" options={[{ value: 'CCCD', label: 'CCCD' }, { value: 'PASSPORT', label: 'Passport (Hộ chiếu)' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="documentNumber" label={identityType === 'PASSPORT' ? 'Số Passport' : 'Số CCCD'} dependencies={['identityType']} rules={[
                { required: true, whitespace: true, message: 'Vui lòng nhập số giấy tờ' },
                {
                  validator: (_, value) => {
                    const number = (value || '').toUpperCase().replace(/[\s.-]/g, '');
                    const valid = identityType === 'PASSPORT' ? /^[A-Z0-9]{5,20}$/.test(number) : /^\d{12}$/.test(number);
                    return !value || valid ? Promise.resolve() : Promise.reject(new Error(identityType === 'PASSPORT' ? 'Số Passport gồm 5–20 ký tự chữ hoặc số' : 'Số CCCD gồm 12 chữ số'));
                  },
                },
              ]}>
                <Input size="large" maxLength={50} autoComplete="off" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="displayName" label="Họ và tên theo giấy tờ" rules={[{ required: true, min: 2 }]}>
                <Input size="large" autoComplete="name" autoCapitalize="words" onBlur={(event) => form.setFieldValue('displayName', capitalizeRegistrationName(event.target.value))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label="Số điện thoại">
                <Input size="large" autoComplete="tel" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="Email đăng nhập" rules={[{ required: true }, { type: 'email' }]}>
                <Input size="large" autoComplete="email" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, min: 8, message: 'Mật khẩu tối thiểu 8 ký tự' }]}>
                <Input.Password size="large" autoComplete="new-password" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="birthDate" label="Ngày sinh" rules={[{ required: true }]}>
                <DatePicker needConfirm={false} size="large" className="w-full" format="DD/MM/YYYY" disabledDate={(date) => date.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="gender" label="Giới tính" rules={[{ required: true }]}>
                <Select size="large" options={[{ value: 'MALE', label: 'Nam' }, { value: 'FEMALE', label: 'Nữ' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="countryId" label="Quốc gia" rules={[{ required: true }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  size="large"
                  onChange={() => form.setFieldValue('federationId', undefined)}
                  options={countries.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="federationId" label="Đơn vị / CLB" extra="Trưởng đoàn cần được SportData duyệt để đăng ký đại diện đơn vị.">
                <Select allowClear showSearch optionFilterProp="label" size="large" disabled={!countryId} placeholder="Để trống nếu không thuộc đơn vị" options={federations.filter((item) => item.countryId === countryId).map((item) => ({ value: item.id, label: item.name }))} />
              </Form.Item>
            </Col>
          </Row>
          <Button block size="large" type="primary" htmlType="submit" loading={loading} icon={<UserPlus className="h-4 w-4" />}>
            Tạo tài khoản
          </Button>
        </Form>
        <p className="mt-6 text-center text-sm text-slate-400">
          Đã có tài khoản? <Link className="font-semibold text-sky-400" href="/account/login">Đăng nhập</Link>
        </p>
      </Card>
      </div>
    </main>
  );
}
