'use client';

import type { CSSProperties } from 'react';
import { certificateSize, certificateText, type CertificateDesign, type CertificateElement, type CertificateEvent, type CertificateRecipient } from '@/lib/certificate-design';
import styles from './EventCertificates.module.css';

export function certificateElementStyle(element: CertificateElement, design: CertificateDesign): CSSProperties {
  const size = certificateSize(design.orientation);
  return {
    left: `${element.x / size.width * 100}%`, top: `${element.y / size.height * 100}%`,
    width: `${element.width / size.width * 100}%`, height: `${element.height / size.height * 100}%`,
    fontSize: `calc(100cqw * ${element.fontSize * 25.4 / 72 / size.width})`,
    fontFamily: element.fontFamily === 'serif' ? '"Times New Roman", serif' : 'Arial, sans-serif',
    fontWeight: element.bold ? 700 : 400, fontStyle: element.italic ? 'italic' : 'normal',
    color: element.color, textAlign: element.align,
  };
}

export function CertificateSheet({ design, event, recipient, background }: { design: CertificateDesign; event: CertificateEvent; recipient: CertificateRecipient; background?: string | null }) {
  const size = certificateSize(design.orientation);
  return <div className={styles.sheet} style={{ aspectRatio: `${size.width}/${size.height}` }}>
    {/* Blob URL from the authenticated background endpoint; preserve the original A4 proportions. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {background && <img src={background} alt="Phôi giấy chứng nhận" className={styles.background} />}
    <div className={styles.content} style={{ transform: `translate(${design.offsetX / size.width * 100}%, ${design.offsetY / size.height * 100}%)` }}>
      {design.elements.map((element) => <div key={element.id} className={styles.field} style={certificateElementStyle(element, design)}>{certificateText(element, recipient, event, design)}</div>)}
    </div>
  </div>;
}
