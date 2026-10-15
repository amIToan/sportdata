import { certificateSize, certificateText, type CertificateDesign, type CertificateEvent, type CertificateRecipient } from './certificate-design';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function certificatePrintHtml(design: CertificateDesign, event: CertificateEvent, recipients: CertificateRecipient[], background?: string) {
  const size = certificateSize(design.orientation);
  const pages = recipients.map((recipient) => `<section class="sheet">${background ? `<img class="background" src="${escapeHtml(background)}" alt="">` : ''}<div class="content">${design.elements.map((element) => `<div class="field" style="left:${element.x}mm;top:${element.y}mm;width:${element.width}mm;height:${element.height}mm;font-size:${element.fontSize}pt;font-family:${element.fontFamily === 'serif' ? "'Times New Roman',serif" : 'Arial,sans-serif'};font-weight:${element.bold ? 700 : 400};font-style:${element.italic ? 'italic' : 'normal'};color:${element.color};text-align:${element.align}">${escapeHtml(certificateText(element, recipient, event, design))}</div>`).join('')}</div></section>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Giấy chứng nhận</title><style>
    @page{size:A4 ${design.orientation};margin:0}
    *{box-sizing:border-box}html,body{margin:0;padding:0;background:white}
    .sheet{position:relative;width:${size.width}mm;height:${size.height}mm;overflow:hidden;break-after:page;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .sheet:last-child{break-after:auto}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}
    .content{position:absolute;inset:0;transform:translate(${design.offsetX}mm,${design.offsetY}mm)}
    .field{position:absolute;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.2;overflow:hidden}
    </style></head><body>${pages}</body></html>`;
}

export async function printCertificates(html: string) {
  const frame = document.createElement('iframe');
  frame.title = 'Bản in giấy chứng nhận';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:1000px;border:0';
  document.body.appendChild(frame);
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { clearTimeout(cleanupTimer); frame.remove(); };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Không thể chuẩn bị trang in')), 30000);
      frame.onload = () => { clearTimeout(timeout); resolve(); };
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument!;
    await Promise.race([
      Promise.all([doc.fonts.ready, ...Array.from(doc.images).map((image) => image.decode())]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Không tải được phôi để in')), 30000)),
    ]);
    const overflowing = Array.from(doc.querySelectorAll<HTMLElement>('.field')).some((field) => field.scrollHeight > field.clientHeight + 1 || field.scrollWidth > field.clientWidth + 1);
    if (overflowing) throw new Error('Có nội dung vượt khung chữ. Hãy tăng kích thước vùng chữ hoặc giảm cỡ chữ trước khi in.');
    frame.contentWindow!.addEventListener('afterprint', cleanup, { once: true });
    cleanupTimer = setTimeout(cleanup, 300000);
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
  } catch (error) { cleanup(); throw error; }
}
