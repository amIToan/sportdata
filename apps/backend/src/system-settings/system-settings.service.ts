import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { INTEGRATION_FIELDS } from './integration-config';
import { validateR2Options } from '../storage/r2-storage.provider';
import { AthleteMediaType, DocumentVerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';

export type SystemFeatureKey =
  | 'identityOcrEnabled'
  | 'paymentsEnabled'
  | 'momoEnabled'
  | 'vnpayEnabled'
  | 'bankQrEnabled'
  | 'ticketEmailEnabled';

const SETTINGS_ID = 'global';

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private encryptionKey() {
    const key = process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!key || key.length < 32 || /change-me/i.test(key)) {
      throw new ServiceUnavailableException('Cần SETTINGS_ENCRYPTION_KEY tối thiểu 32 ký tự để lưu khóa bí mật.');
    }
    return createHash('sha256').update(key).digest();
  }

  private encrypt(name: string, value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    cipher.setAAD(Buffer.from(name));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
  }

  private decrypt(name: string, value: string) {
    try {
      const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
      cipher.setAAD(Buffer.from(name));
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Không thể giải mã cấu hình tích hợp. Kiểm tra khóa mã hóa trên máy chủ.');
    }
  }

  async integrationValues(names?: string[]): Promise<Record<string, string | undefined>> {
    const rows = await this.prisma.integrationSetting.findMany(names ? { where: { name: { in: names } } } : undefined);
    const overrides = new Map(rows.map((row) => [row.name, row.value]));
    return Object.fromEntries(INTEGRATION_FIELDS.filter((field) => !names || names.includes(field.name)).map((field) => {
      const stored = overrides.get(field.name);
      return [field.name, stored === undefined ? process.env[field.name] :
        ('secret' in field && field.secret ? this.decrypt(field.name, stored) : stored)];
    }));
  }

  async integrations() {
    const rows = await this.prisma.integrationSetting.findMany();
    const overrides = new Map(rows.map((row) => [row.name, row]));
    return INTEGRATION_FIELDS.map((field) => {
      const stored = overrides.get(field.name);
      const secret = 'secret' in field && field.secret;
      const value = stored?.value ?? process.env[field.name] ?? '';
      return { ...field, secret, configured: Boolean(value),
        source: stored ? 'database' : value ? 'environment' : 'unset',
        value: secret ? '' : value, updatedAt: stored?.updatedAt ?? null };
    });
  }

  async updateIntegrations(values: Record<string, string | null>) {
    if (values.STORAGE_DRIVER === 'r2') {
      const current = await this.integrationValues(INTEGRATION_FIELDS.filter((field) => field.group === 'Cloudflare R2').map((field) => field.name));
      const merged = { ...current };
      for (const [name, value] of Object.entries(values)) {
        merged[name] = value === null ? process.env[name] : typeof value === 'string' ? value.trim() : undefined;
      }
      try {
        validateR2Options({ bucket: merged.STORAGE_R2_BUCKET, accountId: merged.STORAGE_R2_ACCOUNT_ID,
          endpoint: merged.STORAGE_R2_ENDPOINT, accessKeyId: merged.STORAGE_R2_ACCESS_KEY_ID,
          secretAccessKey: merged.STORAGE_R2_SECRET_ACCESS_KEY });
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
    }
    const operations = Object.entries(values).map(([name, input]) => {
      const field = INTEGRATION_FIELDS.find((item) => item.name === name);
      if (!field) throw new BadRequestException(`Không cho phép chỉnh sửa ${name}`);
      if (input === null) return this.prisma.integrationSetting.deleteMany({ where: { name } });
      if (typeof input !== 'string' || input.length > 4096 || /[\r\n\x00]/.test(input)) {
        throw new BadRequestException(`Giá trị ${name} không hợp lệ`);
      }
      const secret = 'secret' in field && field.secret;
      const value = secret ? input : input.trim();
      if (!value) throw new BadRequestException(`Nhập ${name} hoặc dùng Xóa để trở về ENV`);
      if ('kind' in field) {
        if (field.kind === 'port' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) {
          throw new BadRequestException('Cổng SMTP phải từ 1 đến 65535');
        }
        if (field.kind === 'boolean' && !['true', 'false'].includes(value)) {
          throw new BadRequestException(`${name} phải là true hoặc false`);
        }
        if (field.kind === 'storageDriver' && !['local', 's3', 'cloudinary', 'r2'].includes(value)) {
          throw new BadRequestException('Nơi lưu file phải là local, s3, cloudinary hoặc r2');
        }
        if (field.kind === 'r2AccountId' && !/^[a-f0-9]{32}$/i.test(value)) {
          throw new BadRequestException('Cloudflare Account ID phải gồm 32 ký tự hexadecimal');
        }
        if (field.kind === 'r2Endpoint') {
          try { validateR2Options({ bucket: 'validation', endpoint: value, accessKeyId: 'validation', secretAccessKey: 'validation' }); }
          catch (error) { throw new BadRequestException((error as Error).message); }
        }
        if (field.kind === 'url') {
          try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
          } catch { throw new BadRequestException(`${name} phải là URL HTTPS không chứa thông tin đăng nhập`); }
        }
      }
      const storedValue = secret ? this.encrypt(name, value) : value;
      return this.prisma.integrationSetting.upsert({ where: { name },
        create: { name, value: storedValue }, update: { value: storedValue } });
    });
    await this.prisma.$transaction(operations);
    return this.integrations();
  }

  async get() {
    const config = await this.integrationValues();
    const stored = await this.prisma.systemSetting.findUnique({ where: { id: SETTINGS_ID } });
    const values = {
      identityOcrEnabled: stored?.identityOcrEnabled ?? this.envEnabled('IDENTITY_OCR_ENABLED'),
      paymentsEnabled: stored?.paymentsEnabled ?? this.envEnabled('PAYMENTS_ENABLED', true),
      momoEnabled: stored?.momoEnabled ?? this.envEnabled('MOMO_ENABLED'),
      vnpayEnabled: stored?.vnpayEnabled ?? this.envEnabled('VNPAY_ENABLED'),
      bankQrEnabled: stored?.bankQrEnabled ?? this.envEnabled('BANK_QR_ENABLED', true),
      ticketEmailEnabled: stored?.ticketEmailEnabled ?? this.envEnabled('TICKET_EMAIL_ENABLED', true),
    };
    const configured = {
      identityOcrEnabled: Boolean(config.FPT_AI_API_KEY?.trim()),
      paymentsEnabled: true,
      momoEnabled: Boolean(
        config.MOMO_PARTNER_CODE?.trim()
        && config.MOMO_ACCESS_KEY?.trim()
        && config.MOMO_SECRET_KEY?.trim(),
      ),
      vnpayEnabled: Boolean(
        config.VNPAY_TMN_CODE?.trim()
        && config.VNPAY_HASH_SECRET?.trim(),
      ),
      bankQrEnabled: true,
      ticketEmailEnabled: Boolean(config.SMTP_HOST?.trim()),
    };
    const effective = {
      identityOcrEnabled: values.identityOcrEnabled && configured.identityOcrEnabled,
      paymentsEnabled: values.paymentsEnabled,
      momoEnabled: values.paymentsEnabled && values.momoEnabled && configured.momoEnabled,
      vnpayEnabled: values.paymentsEnabled && values.vnpayEnabled && configured.vnpayEnabled,
      bankQrEnabled: values.paymentsEnabled && values.bankQrEnabled,
      ticketEmailEnabled: values.ticketEmailEnabled && configured.ticketEmailEnabled,
    };

    return {
      values,
      configured,
      effective,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
      updatedAt: stored?.updatedAt ?? null,
    };
  }

  async update(dto: UpdateSystemSettingsDto) {
    const data = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => typeof value === 'boolean'),
    ) as UpdateSystemSettingsDto;
    await this.prisma.systemSetting.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    if (dto.identityOcrEnabled === false) {
      await this.prisma.athleteMedia.updateMany({
        where: {
          type: { in: [AthleteMediaType.CCCD_FRONT, AthleteMediaType.CCCD_BACK, AthleteMediaType.PASSPORT] },
          verificationStatus: DocumentVerificationStatus.PENDING,
        },
        data: {
          verificationStatus: DocumentVerificationStatus.VERIFIED,
          verificationNote: 'Tự động duyệt vì OCR CCCD / Hộ chiếu đang tắt.',
          verifiedAt: new Date(),
          verifiedBy: 'SYSTEM:OCR_DISABLED',
        },
      });
      await this.prisma.eventParticipationMedia.updateMany({
        where: {
          type: { in: [AthleteMediaType.CCCD_FRONT, AthleteMediaType.CCCD_BACK, AthleteMediaType.PASSPORT] },
          verificationStatus: DocumentVerificationStatus.PENDING,
        },
        data: {
          verificationStatus: DocumentVerificationStatus.VERIFIED,
          verifiedAt: new Date(),
          verifiedBy: 'SYSTEM:OCR_DISABLED',
        },
      });
      await this.prisma.participantAccountMedia.updateMany({
        where: {
          type: { in: [AthleteMediaType.CCCD_FRONT, AthleteMediaType.CCCD_BACK, AthleteMediaType.PASSPORT] },
          verificationStatus: DocumentVerificationStatus.PENDING,
        },
        data: {
          verificationStatus: DocumentVerificationStatus.VERIFIED,
          verificationNote: 'Tự động duyệt vì OCR CCCD / Hộ chiếu đang tắt.',
          verifiedAt: new Date(),
          verifiedBy: 'SYSTEM:OCR_DISABLED',
        },
      });
    }
    return this.get();
  }

  async enabled(key: SystemFeatureKey) {
    const settings = await this.get();
    return settings.effective[key];
  }

  private envEnabled(name: string, fallback = false) {
    const value = process.env[name]?.trim();
    if (!value) return fallback;
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
}
