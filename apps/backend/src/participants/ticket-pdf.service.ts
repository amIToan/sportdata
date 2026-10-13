import { Injectable } from "@nestjs/common";
import pdfMake from "pdfmake/build/pdfmake";
import vfsFonts from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { POINTS_PER_MM, TICKET_WIDTH, TICKET_HEIGHT, ticketDesign, ticketTextSvg, ticketTextValue, type TicketCategoryContent } from '../events/ticket-design';

export type TicketPayload = {
  ticketCode: string;
  roleLabel?: string;
  status: string;
  paymentStatus?: string;
  isValid?: boolean;
  event: {
    name: string;
    startDate: Date | string;
    endDate?: Date | string;
    location?: string | null;
    logoUrl?: string | null;
    ticketBackgroundUrl?: string | null;
    ticketDesign?: unknown;
    ticketThemePreset?: string | null;
    ticketLayout?: string | null;
    ticketPrimaryColor?: string | null;
    ticketSecondaryColor?: string | null;
    ticketAccentColor?: string | null;
  };
  sport?: { name: string } | null;
  category: {
    name: string;
    minWeight?: number | null;
    maxWeight?: number | null;
  };
  categories?: TicketCategoryContent[];
  athlete: {
    fullName: string;
    birthDate?: Date | string | null;
    gender?: string;
    weight?: number | null;
    country?: { name?: string } | null;
    federation?: { name?: string } | null;
  };
  achievements?: {
    career?: {
      totalMatches?: number;
      totalWins?: number;
      goldMedals?: number;
      silverMedals?: number;
      bronzeMedals?: number;
    };
  };
  assets?: {
    backgroundData?: Buffer | null;
    backgroundMimeType?: string | null;
    avatarData?: Buffer | null;
    avatarMimeType?: string | null;
  };
};

export type TicketBatchMeta = {
  referenceCode: string;
  organizationName?: string | null;
  contactName?: string | null;
};

pdfMake.addVirtualFileSystem(vfsFonts);
pdfMake.addFonts({
  Roboto: {
    normal: "Roboto-Regular.ttf",
    bold: "Roboto-Medium.ttf",
    italics: "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf",
  },
});

const A6_WIDTH = TICKET_WIDTH * POINTS_PER_MM;
const A6_HEIGHT = TICKET_HEIGHT * POINTS_PER_MM;

@Injectable()
export class TicketPdfService {
  async generate(tickets: TicketPayload[], batch?: TicketBatchMeta) {
    const pages: Content[] = [];
    if (batch && tickets.length > 1)
      pages.push(this.batchCover(tickets, batch));
    tickets.forEach((ticket) => {
      pages.push({
        ...(pages.length ? { pageBreak: "before" as const } : {}),
        stack: this.ticketPage(ticket),
      });
    });

    const definition: TDocumentDefinitions = {
      pageSize: { width: A6_WIDTH, height: A6_HEIGHT },
      pageMargins: [0, 0, 0, 0],
      defaultStyle: { font: "Roboto", color: "#0f172a", fontSize: 8 },
      content: pages,
      info: {
        title: batch
          ? `Bộ thẻ ${batch.referenceCode}`
          : `Thẻ ${tickets[0]?.ticketCode || ""}`,
        author: "SportData Việt Nam",
        subject: "Thẻ tham dự sự kiện khổ A6",
      },
    };
    const bytes = await pdfMake.createPdf(definition).getBuffer();
    return Buffer.from(bytes);
  }

  private batchCover(
    tickets: TicketPayload[],
    batch: TicketBatchMeta,
  ): Content {
    return {
      stack: [
        { canvas: [{ type: 'rect', x: 0, y: 0, w: A6_WIDTH, h: A6_HEIGHT, color: '#0f172a' }], absolutePosition: { x: 0, y: 0 } },
        {
          text: "SPORTDATA",
          color: "#38bdf8",
          bold: true,
          fontSize: 13,
          characterSpacing: 1.4,
          margin: [10, 36, 10, 0],
        },
        {
          text: "BỘ THẺ VẬN ĐỘNG VIÊN",
          color: "#ffffff",
          bold: true,
          fontSize: 23,
          margin: [10, 52, 10, 10],
        },
        {
          text: batch.organizationName || "Đơn vị đăng ký",
          color: "#7dd3fc",
          bold: true,
          fontSize: 14,
          margin: [10, 0, 10, 22],
        },
        {
          table: {
            widths: ["*"],
            body: [
              [
                {
                  stack: [
                    {
                      text: `${tickets.length} VẬN ĐỘNG VIÊN`,
                      bold: true,
                      fontSize: 18,
                      color: "#0369a1",
                    },
                    {
                      text: `Mã hồ sơ: ${batch.referenceCode}`,
                      margin: [0, 8, 0, 0],
                    },
                    {
                      text: `Người liên hệ: ${batch.contactName || "—"}`,
                      margin: [0, 3, 0, 0],
                    },
                    {
                      text: "Các trang tiếp theo là thẻ riêng để in, cắt và cấp cho từng vận động viên.",
                      color: "#475569",
                      margin: [0, 12, 0, 0],
                    },
                  ],
                  margin: [14, 16, 14, 16],
                  fillColor: "#ffffff",
                },
              ],
            ],
          },
          layout: "noBorders",
          margin: [10, 0, 10, 0],
        },
        {
          text: "Mỗi thẻ có QR độc lập để kiểm tra thông tin và trạng thái check-in.",
          color: "#cbd5e1",
          alignment: "center",
          fontSize: 8,
          margin: [18, 42, 18, 0],
        },
      ],
    };
  }

  private ticketPage(ticket: TicketPayload): Content[] {
    const verificationUrl = `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/tickets/${encodeURIComponent(ticket.ticketCode)}`;
    const background = this.dataUrl(ticket.assets?.backgroundData, ticket.assets?.backgroundMimeType);
    const avatar = this.dataUrl(ticket.assets?.avatarData, ticket.assets?.avatarMimeType);
    // Every region is positioned in paper coordinates, independent of content flow.
    const content: Content[] = [{ text: '', fontSize: 1 }];
    if (background) {
      const dimensions = this.imageDimensions(ticket.assets!.backgroundData!);
      const scale = Math.min(A6_WIDTH / dimensions.width, A6_HEIGHT / dimensions.height);
      const width = dimensions.width * scale;
      const height = dimensions.height * scale;
      content.push({ image: background, width, height, absolutePosition: { x: (A6_WIDTH - width) / 2, y: (A6_HEIGHT - height) / 2 } });
    }
    for (const element of ticketDesign(ticket.event.ticketDesign).elements) {
      const width = element.width * POINTS_PER_MM;
      const height = element.height * POINTS_PER_MM;
      const absolutePosition = { x: element.x * POINTS_PER_MM, y: element.y * POINTS_PER_MM };
      if (element.type === 'PHOTO') {
        content.push(avatar
          ? { image: avatar, cover: { width, height, align: 'center', valign: 'center' }, absolutePosition }
          : { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#e2e8f0"/><text x="20" y="31" font-family="Roboto" font-size="3" text-anchor="middle" fill="#64748b">Ảnh 4 × 6 cm</text></svg>`, width, height, absolutePosition });
      } else if (element.type === 'QR') {
        const padding = width * 0.1;
        content.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: width, h: height, color: '#ffffff' }], absolutePosition });
        content.push({ qr: verificationUrl, fit: width - padding * 2, foreground: '#07111f', background: '#ffffff', eccLevel: 'M', absolutePosition: { x: absolutePosition.x + padding, y: absolutePosition.y + padding } });
      } else {
        content.push({ svg: ticketTextSvg(element, ticketTextValue(element, ticket)), width, height, absolutePosition });
      }
    }
    return content;
  }

  // JPG and PNG are the accepted upload formats. Fit the original image without stretching.
  private imageDimensions(data: Buffer): { width: number; height: number } {
    const bytes = Buffer.from(data);
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
      if (width && height) return { width, height };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) break;
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const length = bytes.readUInt16BE(offset);
        if (length < 2 || offset + length > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
          const height = bytes.readUInt16BE(offset + 3); const width = bytes.readUInt16BE(offset + 5);
          if (width && height) return { width, height };
        }
        offset += length;
      }
    }
    throw new Error('Ảnh nền thẻ không phải JPG/PNG hợp lệ');
  }

  private dataUrl(data?: Buffer | null, mimeType?: string | null) {
    if (!data || !mimeType || !["image/jpeg", "image/png"].includes(mimeType))
      return null;
    return `data:${mimeType};base64,${Buffer.from(data).toString("base64")}`;
  }

}
