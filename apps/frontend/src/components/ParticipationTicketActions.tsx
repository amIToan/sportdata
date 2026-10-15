'use client';

import { Button, Space, Tooltip } from 'antd';
import { Download, Eye, Printer } from 'lucide-react';

export function ParticipationTicketActions({ code, status, compact = false }: { code: string; status: string; compact?: boolean }) {
  return <Space wrap={!compact} size={compact ? 4 : 8}>
    <Tooltip title={compact ? 'Xem thẻ' : undefined}><Button size={compact ? 'small' : 'middle'} aria-label="Xem thẻ" icon={compact ? <Eye size={16} /> : undefined} href={`/tickets/${encodeURIComponent(code)}`} target="_blank" rel="noopener noreferrer">{!compact && 'Xem thẻ'}</Button></Tooltip>
    {status === 'CONFIRMED' && <>
      <Tooltip title={compact ? 'In thẻ' : undefined}><Button size={compact ? 'small' : 'middle'} type="primary" aria-label="In thẻ" icon={<Printer className="h-4 w-4" />} href={`/tickets/${encodeURIComponent(code)}?print=1`} target="_blank" rel="noopener noreferrer">{!compact && 'In thẻ'}</Button></Tooltip>
      <Tooltip title={compact ? 'Tải thẻ PDF' : undefined}><Button size={compact ? 'small' : 'middle'} aria-label="Tải thẻ PDF" icon={<Download className="h-4 w-4" />} href={`/api/participant-auth/tickets/${encodeURIComponent(code)}/pdf`} target="_blank" rel="noopener noreferrer">{!compact && 'Tải thẻ PDF'}</Button></Tooltip>
    </>}
  </Space>;
}
