export const eventRoleOptions = [
  { value: 'ATTENDEE', label: 'Người tham gia bình thường' },
  { value: 'ATHLETE', label: 'VĐV' },
  { value: 'REFEREE', label: 'Trọng tài' },
  { value: 'TEAM_LEADER', label: 'Trưởng đoàn' },
  { value: 'COACH', label: 'Huấn luyện viên' },
  { value: 'MEDICAL_STAFF', label: 'Nhân viên y tế' },
] as const;

export type EventRole = typeof eventRoleOptions[number]['value'];
export type ParticipationRole = Exclude<EventRole, 'ATHLETE'>;
export const participationStatusLabels: Record<string, string> = {
  SUBMITTED: 'Chờ duyệt', CONFIRMED: 'Đã xác nhận', REJECTED: 'Đã từ chối', CANCELLED: 'Đã hủy',
};
export const eventRoleLabel = (role: string) => eventRoleOptions.find((item) => item.value === role)?.label || role;

export type EventParticipation = {
  id: string;
  role: ParticipationRole;
  referenceCode: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  identityType?: 'CCCD' | 'PASSPORT' | null;
  documentNumber?: string;
  media?: { type: 'AVATAR' | 'CCCD_FRONT' | 'CCCD_BACK' | 'PASSPORT'; mimeType: string; size: number; verificationStatus?: string | null }[];
  status: string;
  statusReason?: string | null;
  createdAt: string;
  event: { id: string; name: string; startDate: string; location?: string | null };
  federation?: { id: string; name: string } | null;
};
