'use client';

import Link from 'next/link';
import { ArrowUpRight, Check, Flag, ShieldCheck, Trophy, Users } from 'lucide-react';
import { type EventRole } from '@/lib/event-participation';

export const registrationRoles = [
  { value: 'ATHLETE', label: 'Vận động viên', description: 'Chọn nội dung thi đấu và gửi hồ sơ VĐV cá nhân hoặc đội.', icon: Trophy },
  { value: 'REFEREE', label: 'Trọng tài', description: 'Đăng ký tham gia công tác trọng tài tại sự kiện.', icon: ShieldCheck },
  { value: 'TEAM_LEADER', label: 'Trưởng đoàn', description: 'Chọn Liên đoàn bạn đại diện tại sự kiện này.', icon: Flag },
  { value: 'COACH', label: 'Huấn luyện viên', description: 'Tham gia với vai trò huấn luyện, hỗ trợ VĐV.', icon: Users },
] as const;

export function RegistrationRolePicker({ eventId, value, onSelect, disabled = false }: {
  eventId: string; value?: EventRole; onSelect?: (role: EventRole) => void; disabled?: boolean;
}) {
  return <div className="registration-role-grid" role="group" aria-label="Vai trò tham gia sự kiện">
    {registrationRoles.map(({ value: role, label, description, icon: Icon }) => {
      const content = <><span className="registration-role-icon"><Icon size={22} /></span><span className="registration-role-copy"><strong>{label}</strong><span>{description}</span></span>{value === role ? <Check className="registration-role-arrow" size={19} /> : <ArrowUpRight className="registration-role-arrow" size={18} />}</>;
      const className = `registration-role-choice${value === role ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`;
      return onSelect || disabled
        ? <button key={role} type="button" className={className} disabled={disabled} aria-pressed={onSelect ? value === role : undefined} onClick={() => onSelect?.(role)}>{content}</button>
        : <Link key={role} className={className} href={`/events/${eventId}/register?role=${role}`}>{content}</Link>;
    })}
  </div>;
}
