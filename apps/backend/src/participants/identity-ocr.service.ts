import { BadRequestException, Injectable } from '@nestjs/common';
import { AthleteMediaType } from '@prisma/client';
import { SystemSettingsService } from '../system-settings/system-settings.service';

export type IdentityOcrFields = {
  documentType?: 'CCCD' | 'PASSPORT';
  documentNumber?: string;
  fullName?: string;
  dateOfBirth?: string;
  sex?: string;
  nationality?: string;
  placeOfOrigin?: string;
  address?: string;
  issuedAt?: string;
  expiresAt?: string;
  placeOfBirth?: string;
};

export type IdentityOcrResult = {
  status: 'COMPLETED' | 'FAILED' | 'NOT_CONFIGURED';
  provider: 'FPT_AI' | null;
  confidence: number | null;
  fields: IdentityOcrFields;
  fieldConfidence: Record<string, number>;
  message?: string;
};

type ProviderField = string | number | null | undefined | {
  value?: string | number | null;
  probability?: number | string | null;
};

@Injectable()
export class IdentityOcrService {
  constructor(private readonly settings: SystemSettingsService) {}

  async read(file: Express.Multer.File, type: AthleteMediaType): Promise<IdentityOcrResult> {
    if (type !== AthleteMediaType.CCCD_FRONT && type !== AthleteMediaType.CCCD_BACK && type !== AthleteMediaType.PASSPORT) {
      throw new BadRequestException('Loại tệp không hỗ trợ đọc giấy tờ');
    }
    const systemSettings = await this.settings.get();
    if (!systemSettings.values.identityOcrEnabled) {
      return {
        status: 'NOT_CONFIGURED',
        provider: null,
        confidence: null,
        fields: {},
        fieldConfidence: {},
      };
    }

    if (!file.mimetype.startsWith('image/')) {
      return this.failure('OCR chỉ đọc ảnh JPG, PNG hoặc WebP. PDF vẫn được lưu để CMS kiểm duyệt.');
    }
    if (file.size > 5 * 1024 * 1024) {
      return this.failure('Ảnh vượt quá giới hạn 5 MB của dịch vụ OCR.');
    }

    const integration = await this.settings.integrationValues();
    const apiKey = integration.FPT_AI_API_KEY?.trim();
    if (!systemSettings.configured.identityOcrEnabled || !apiKey) {
      return {
        status: 'NOT_CONFIGURED',
        provider: null,
        confidence: null,
        fields: {},
        fieldConfidence: {},
        message: 'Chưa cấu hình FPT_AI_API_KEY. Ảnh đã được lưu và sẽ chờ CMS kiểm duyệt thủ công.',
      };
    }

    const endpoint = type === AthleteMediaType.PASSPORT
      ? (integration.FPT_AI_PASSPORT_ENDPOINT || 'https://api.fpt.ai/vision/passport/vnm')
      : (integration.FPT_AI_ID_ENDPOINT || 'https://api.fpt.ai/vision/idr/vnm/');
    const body = new FormData();
    body.append('image', new Blob([Uint8Array.from(file.buffer)], { type: file.mimetype }), file.originalname || 'document.jpg');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'api-key': apiKey },
        body,
        signal: AbortSignal.timeout(25_000),
      });
      const payload = await response.json() as Record<string, any>;
      if (!response.ok || payload?.errorCode && String(payload.errorCode) !== '0') {
        return this.failure(payload?.errorMessage || payload?.message || `OCR trả về HTTP ${response.status}`, 'FPT_AI');
      }
      const source = Array.isArray(payload?.data) ? payload.data[0] : payload?.data || payload;
      if (!source || typeof source !== 'object') return this.failure('Dịch vụ OCR không trả về dữ liệu giấy tờ.', 'FPT_AI');

      const fields: IdentityOcrFields = {
        documentType: type === AthleteMediaType.PASSPORT ? 'PASSPORT' : 'CCCD',
        documentNumber: this.text(source.id ?? source.passport_number ?? source.passportNumber),
        fullName: this.text(source.name ?? source.full_name ?? source.fullName),
        dateOfBirth: this.date(this.text(source.dob ?? source.date_of_birth ?? source.dateOfBirth)),
        sex: this.text(source.sex ?? source.gender),
        nationality: this.text(source.nationality),
        placeOfOrigin: this.text(source.home ?? source.place_of_origin),
        address: this.text(source.address ?? source.place_of_residence),
        issuedAt: this.date(this.text(source.issue_date ?? source.issued_at ?? source.date_of_issue)),
        expiresAt: this.date(this.text(source.doe ?? source.expiry ?? source.date_of_expiry)),
        placeOfBirth: this.text(source.place_of_birth ?? source.pob),
      };
      Object.keys(fields).forEach((key) => fields[key as keyof IdentityOcrFields] === undefined && delete fields[key as keyof IdentityOcrFields]);

      const fieldConfidence: Record<string, number> = {};
      const mapping: Record<keyof IdentityOcrFields, string[]> = {
        documentType: [],
        documentNumber: ['id', 'passport_number', 'passportNumber'],
        fullName: ['name', 'full_name', 'fullName'],
        dateOfBirth: ['dob', 'date_of_birth', 'dateOfBirth'],
        sex: ['sex', 'gender'],
        nationality: ['nationality'],
        placeOfOrigin: ['home', 'place_of_origin'],
        address: ['address', 'place_of_residence'],
        issuedAt: ['issue_date', 'issued_at', 'date_of_issue'],
        expiresAt: ['doe', 'expiry', 'date_of_expiry'],
        placeOfBirth: ['place_of_birth', 'pob'],
      };
      for (const [field, keys] of Object.entries(mapping)) {
        const providerValue = keys.map((key) => source[key]).find((value) => value !== undefined);
        const probability = this.probability(providerValue);
        if (probability !== null) fieldConfidence[field] = probability;
      }
      const scores = Object.values(fieldConfidence);
      const confidence = scores.length
        ? scores.reduce((total, value) => total + value, 0) / scores.length
        : this.number(payload?.confidence ?? source?.confidence);

      if (!fields.documentNumber && !fields.fullName) {
        return this.failure('Không đọc được số giấy tờ hoặc họ tên. Vui lòng chụp rõ đủ bốn góc.', 'FPT_AI');
      }
      return { status: 'COMPLETED', provider: 'FPT_AI', confidence, fields, fieldConfidence };
    } catch (error) {
      const message = error instanceof Error && error.name === 'TimeoutError'
        ? 'Dịch vụ OCR quá thời gian phản hồi.'
        : 'Không thể kết nối dịch vụ OCR. Ảnh vẫn có thể được gửi để CMS kiểm duyệt.';
      return this.failure(message, 'FPT_AI');
    }
  }

  private failure(message: string, provider: IdentityOcrResult['provider'] = null): IdentityOcrResult {
    return { status: 'FAILED', provider, confidence: null, fields: {}, fieldConfidence: {}, message };
  }

  private text(value: ProviderField): string | undefined {
    const raw = value && typeof value === 'object' ? value.value : value;
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    return text || undefined;
  }

  private probability(value: ProviderField): number | null {
    if (!value || typeof value !== 'object') return null;
    return this.number(value.probability);
  }

  private number(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed > 1 ? parsed / 100 : parsed;
  }

  private date(value?: string): string | undefined {
    if (!value) return undefined;
    const normalized = value.trim().replace(/[.]/g, '/');
    const parts = normalized.split(/[\/-]/).map((item) => item.trim());
    if (parts.length === 3) {
      const [first, second, third] = parts;
      const yearFirst = first.length === 4;
      const year = yearFirst ? first : third;
      const month = yearFirst ? second : second;
      const day = yearFirst ? third : first;
      if (/^\d{4}$/.test(year) && /^\d{1,2}$/.test(month) && /^\d{1,2}$/.test(day)) {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }
    return value;
  }
}
