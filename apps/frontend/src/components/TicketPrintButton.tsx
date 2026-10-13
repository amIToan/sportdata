'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from 'antd';
import { Printer } from 'lucide-react';
import { useSportDataToast } from '@/hooks/useSportDataToast';

function nextPaint(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      window.cancelAnimationFrame(frame);
      reject(new DOMException('Đã dừng chuẩn bị in', 'AbortError'));
    };
    const frame = window.requestAnimationFrame(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function waitForTicketPrintAssets(stage: HTMLElement, signal: AbortSignal) {
  // Let the card's QR effect replace its initial relative URL before printing.
  await nextPaint(signal);
  await nextPaint(signal);

  const assets = Promise.all([
    document.fonts.load('400 12px Roboto'),
    document.fonts.load('700 12px Roboto'),
    ...Array.from(stage.querySelectorAll('img')).map((image) => image.decode()),
  ]).then(() => document.fonts.ready);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Đã dừng chuẩn bị in', 'AbortError'));
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Không tải được ảnh hoặc phông chữ của thẻ'));
    }, 15_000);
    signal.addEventListener('abort', abort, { once: true });
    assets.then(() => { cleanup(); resolve(); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });

  await nextPaint(signal);
}

/** Mount only for a valid issued ticket; unmounting cancels pending print preparation. */
export function TicketPrintButton({ stageRef, onBeforePrint }: {
  stageRef: RefObject<HTMLDivElement>;
  onBeforePrint: () => Promise<boolean>;
}) {
  const toast = useSportDataToast();
  const [preparing, setPreparing] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const autoPrinted = useRef(false);

  const printTicket = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage || pending.current) return;

    const controller = new AbortController();
    pending.current = controller;
    setPreparing(true);
    try {
      await waitForTicketPrintAssets(stage, controller.signal);
      if (controller.signal.aborted || !stage.isConnected) return;
      if (!await onBeforePrint()) {
        if (!controller.signal.aborted) toast.error('Thẻ chưa được phát hành hoặc không còn hợp lệ.');
        return;
      }
      // Revalidation may update the photo or card design as well as its status.
      await waitForTicketPrintAssets(stage, controller.signal);
      if (controller.signal.aborted || !stage.isConnected) return;
      autoPrinted.current = true;
      window.print();
    } catch {
      if (!controller.signal.aborted) {
        toast.error('Không thể chuẩn bị bản in. Vui lòng thử lại hoặc chọn Tải thẻ PDF.');
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setPreparing(false);
      }
    }
  }, [onBeforePrint, stageRef, toast]);

  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, []);

  useEffect(() => {
    if (autoPrinted.current || new URLSearchParams(window.location.search).get('print') !== '1') return;
    void printTicket();
  }, [printTicket]);

  return <Button type="primary" icon={<Printer className="h-4 w-4" />} loading={preparing} onClick={() => void printTicket()}>In thẻ</Button>;
}
