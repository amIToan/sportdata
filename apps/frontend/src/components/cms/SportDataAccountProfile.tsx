'use client';

import { useEffect, useState } from 'react';
import { Alert, Avatar, Button, Descriptions, Empty, Image, Modal, Skeleton, Space, Tag, Tooltip, Typography } from 'antd';
import { RefreshCw, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { accountTypeLabel, type SportDataAccountType } from '@/lib/sportdata-account-types';

type AccountMediaType = 'AVATAR' | 'CCCD_FRONT' | 'CCCD_BACK' | 'PASSPORT';
type AccountMedia = {
  type: AccountMediaType;
  mimeType: string;
  verificationStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
};

export type SportDataAccount = {
  id: string;
  accountTypes: SportDataAccountType[];
  email: string;
  displayName: string;
  phone?: string | null;
  representativePosition?: string | null;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  isActive: boolean;
  createdAt: string;
  federation?: { id: string; name: string; type: string; country?: { name: string; code: string } } | null;
  profile: {
    hasAvatar: boolean;
    hasIdentityDocuments: boolean;
    complete: boolean;
    identityType: 'CCCD' | 'PASSPORT' | null;
    documentNumber?: string | null;
    media: AccountMedia[];
  };
};

const mediaLabels: Record<AccountMediaType, string> = {
  AVATAR: 'Ảnh thẻ',
  CCCD_FRONT: 'CCCD mặt trước',
  CCCD_BACK: 'CCCD mặt sau',
  PASSPORT: 'Hộ chiếu',
};

export function accountStatusLabel(status: SportDataAccount['verificationStatus']) {
  return status === 'VERIFIED' ? 'Đã duyệt' : status === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt';
}

function useAccountMedia(accountId: string, media?: AccountMedia, variant: 'avatar' | 'preview' = 'preview') {
  const mediaType = media?.type;
  const fallbackMimeType = media?.mimeType;
  const [resource, setResource] = useState<{ url: string; mimeType: string }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!mediaType) return;
    let objectUrl: string | undefined;
    let active = true;
    const controller = new AbortController();
    setResource(undefined);
    setFailed(false);
    void api.get(`/participant-auth/admin/accounts/${accountId}/media/${mediaType}`, {
      responseType: 'blob',
      params: { variant },
      signal: controller.signal,
    }).then((response) => {
      if (!active) return;
      const mimeType = (response.data.type || response.headers['content-type'] || fallbackMimeType || '').split(';')[0].toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mimeType)) {
        setFailed(true);
        return;
      }
      const blob = new Blob([response.data], { type: mimeType });
      objectUrl = URL.createObjectURL(blob);
      setResource({ url: objectUrl, mimeType });
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, mediaType, fallbackMimeType, variant, attempt]);

  return { resource, failed, retry: () => setAttempt((current) => current + 1), markFailed: () => setFailed(true) };
}

export function AccountAvatar({ account, size = 44 }: { account: SportDataAccount; size?: number }) {
  const media = account.profile.media.find((item) => item.type === 'AVATAR');
  const { resource, failed, markFailed } = useAccountMedia(account.id, media, 'avatar');
  return (
    <Tooltip title={!account.profile.hasAvatar ? 'Chưa có ảnh thẻ' : failed ? 'Không tải được ảnh thẻ' : undefined}>
      <Avatar size={size} src={media && !failed && resource?.mimeType.startsWith('image/') ? resource.url : undefined} icon={<UserRound className="h-5 w-5" />} className="shrink-0" onError={() => { markFailed(); return false; }} />
    </Tooltip>
  );
}

export function ProfileCompletionTags({ account }: { account: SportDataAccount }) {
  return (
    <Space size={[0, 4]} wrap>
      {account.profile.complete
        ? <Tooltip title="Đã tải ảnh thẻ và CCCD đủ hai mặt hoặc hộ chiếu. Giấy tờ có trạng thái xác thực riêng."><Tag color="success">Đủ ảnh & giấy tờ</Tag></Tooltip>
        : <>
          {!account.profile.hasAvatar && <Tag color="warning">Thiếu ảnh thẻ</Tag>}
          {!account.profile.hasIdentityDocuments && <Tag color="warning">Thiếu CCCD / hộ chiếu</Tag>}
        </>}
    </Space>
  );
}

function AccountDocumentPreview({ accountId, media }: { accountId: string; media: AccountMedia }) {
  const { resource, failed, retry, markFailed } = useAccountMedia(accountId, media);
  const status = media.verificationStatus === 'VERIFIED'
    ? { color: 'success', label: 'Đã xác thực' }
    : media.verificationStatus === 'REJECTED'
      ? { color: 'error', label: 'Từ chối' }
      : { color: 'processing', label: 'Chờ xác thực' };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-500/20">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-500/15 p-3">
        <strong className="text-sm">{mediaLabels[media.type]}</strong>
        {media.type !== 'AVATAR' && <Tag color={status.color} className="!m-0">{status.label}</Tag>}
      </div>
      <div className="flex min-h-56 items-center justify-center bg-slate-500/5">
        {failed ? (
          <div className="space-y-3 p-5 text-center">
            <Typography.Text type="secondary" className="!block">Không thể tải {mediaLabels[media.type].toLocaleLowerCase('vi-VN')}.</Typography.Text>
            <Button size="small" icon={<RefreshCw className="h-3 w-3" />} onClick={retry}>Thử lại</Button>
          </div>
        ) : !resource ? <Skeleton.Image active /> : resource.mimeType === 'application/pdf' ? (
          <div className="w-full">
            <iframe src={`${resource.url}#navpanes=0`} title={mediaLabels[media.type]} className="h-80 w-full bg-white" />
            <div className="p-2 text-center"><Button size="small" href={resource.url} target="_blank" rel="noopener noreferrer">Mở PDF</Button></div>
          </div>
        ) : (
          <Image src={resource.url} alt={mediaLabels[media.type]} width="100%" height={224} className="object-contain" preview={{ mask: 'Xem rõ ảnh' }} onError={markFailed} />
        )}
      </div>
    </div>
  );
}

export function AccountProfileModal({ account, open, onClose }: { account?: SportDataAccount; open: boolean; onClose: () => void }) {
  const media = account?.profile.media || [];
  return (
    <Modal open={open} onCancel={onClose} footer={<Button onClick={onClose}>Đóng</Button>} title="Hồ sơ tài khoản SportData" width={940} destroyOnHidden>
      {account && <div className="space-y-5 pt-3">
        <div className="flex items-center gap-4 rounded-2xl bg-slate-500/5 p-4">
          <AccountAvatar key={account.id} account={account} size={72} />
          <div className="min-w-0">
            <Typography.Title level={3} className="!mb-1">{account.displayName}</Typography.Title>
            <Space wrap size={[0, 4]}>{account.accountTypes.map((type) => <Tag key={type} color="blue">{accountTypeLabel(type)}</Tag>)}<ProfileCompletionTags account={account} /></Space>
          </div>
        </div>
        <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
          <Descriptions.Item label="Email"><span className="break-all">{account.email}</span></Descriptions.Item>
          <Descriptions.Item label="Số điện thoại">{account.phone || 'Chưa khai báo'}</Descriptions.Item>
          <Descriptions.Item label="Đơn vị">{account.federation?.name || 'Chưa liên kết đơn vị'}</Descriptions.Item>
          <Descriptions.Item label="Chức vụ">{account.representativePosition || 'Chưa khai báo'}</Descriptions.Item>
          <Descriptions.Item label="Duyệt tài khoản">{accountStatusLabel(account.verificationStatus)}</Descriptions.Item>
          <Descriptions.Item label="Hoạt động">{account.isActive ? 'Đang hoạt động' : 'Đã ngừng hoạt động'}</Descriptions.Item>
          <Descriptions.Item label="Ngày đăng ký">{new Date(account.createdAt).toLocaleDateString('vi-VN')}</Descriptions.Item>
          {account.profile.documentNumber && <Descriptions.Item label={account.profile.identityType === 'PASSPORT' ? 'Số hộ chiếu' : 'Số CCCD'}><Typography.Text copyable>{account.profile.documentNumber}</Typography.Text></Descriptions.Item>}
        </Descriptions>
        {!account.profile.complete && <Alert type="warning" showIcon title="Hồ sơ chưa đủ để đăng ký sự kiện." description={<span>{!account.profile.hasAvatar && 'Cần bổ sung ảnh thẻ. '}{!account.profile.hasIdentityDocuments && 'Cần bổ sung CCCD đủ hai mặt hoặc hộ chiếu.'}</span>} />}
        <div>
          <Typography.Title level={5}>Ảnh thẻ & giấy tờ định danh</Typography.Title>
          <Typography.Paragraph type="secondary" className="!text-sm">Kiểm tra ảnh thẻ và nội dung giấy tờ. Trạng thái bên cạnh mỗi giấy tờ là kết quả xác thực giấy tờ đó.</Typography.Paragraph>
          {media.length ? <div className="grid gap-3 sm:grid-cols-2">{media.map((item) => <AccountDocumentPreview key={`${account.id}:${item.type}`} accountId={account.id} media={item} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa tải ảnh thẻ và giấy tờ định danh" />}
        </div>
      </div>}
    </Modal>
  );
}
