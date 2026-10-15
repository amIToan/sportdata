import type { PDFDocumentProxy } from 'pdfjs-dist';

export async function openCertificatePdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
}

export async function renderCertificatePdf(pdf: PDFDocumentProxy, pageNumber: number) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 3508 / Math.max(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Không thể chuyển phôi PDF')), 'image/png'));
  return { file: new File([blob], 'certificate-background.png', { type: 'image/png' }), width: base.width, height: base.height };
}

export async function normalizeCertificateImage(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40000000) throw new Error('Ảnh quá lớn, vui lòng dùng ảnh dưới 40 megapixel');
    const scale = Math.min(1, 3508 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Không thể đọc phôi ảnh')), 'image/png'));
    return { file: new File([blob], 'certificate-background.png', { type: 'image/png' }), width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}
