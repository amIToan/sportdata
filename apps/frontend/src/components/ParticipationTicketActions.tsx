'use client';

import { Button, Space } from 'antd';
import { Download, Printer } from 'lucide-react';

export function ParticipationTicketActions({ code, status }: { code: string; status: string }) {
  return <Space wrap>
    <Button href={`/tickets/${encodeURIComponent(code)}`} target="_blank" rel="noopener noreferrer">Xem thẻ</Button>
    {status === 'CONFIRMED' && <>
      <Button type="primary" icon={<Printer className="h-4 w-4" />} href={`/tickets/${encodeURIComponent(code)}?print=1`} target="_blank" rel="noopener noreferrer">In thẻ</Button>
      <Button icon={<Download className="h-4 w-4" />} href={`/api/participant-auth/tickets/${encodeURIComponent(code)}/pdf`} target="_blank" rel="noopener noreferrer">Tải thẻ PDF</Button>
    </>}
  </Space>;
}
