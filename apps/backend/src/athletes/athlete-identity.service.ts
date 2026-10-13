import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AthleteMediaType, Gender, Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export type AthleteIdentityInput = {
  fullName: string;
  birthDate?: Date | null;
  gender: Gender;
  countryId: string;
  federationId?: string | null;
  phone?: string | null;
  address?: string;
  identityType?: 'CCCD' | 'PASSPORT';
  documentNumber?: string;
};

const text = (value?: string | null) => (value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
const document = (value?: string) => (value || '').toUpperCase().replace(/[\s.-]/g, '');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const phone = (value?: string | null) => {
  const digits = (value || '').replace(/\D/g, '');
  return digits.startsWith('84') && digits.length === 11 ? `0${digits.slice(2)}` : digits;
};

@Injectable()
export class AthleteIdentityService {
  private encryptionKey() {
    const key = process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!key || key.length < 32 || /change-me/i.test(key)) {
      throw new ServiceUnavailableException('Cần khóa mã hóa hợp lệ để lưu số giấy tờ VĐV.');
    }
    return createHash('sha256').update(key).digest();
  }

  private encrypt(value: string, type: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`athlete-document:${type}`));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
  }

  decrypt(value: string, type: 'CCCD' | 'PASSPORT') {
    try {
      const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
      cipher.setAAD(Buffer.from(`athlete-document:${type}`));
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Không thể giải mã số giấy tờ. Kiểm tra khóa mã hóa máy chủ.');
    }
  }

  async lock(transaction: Prisma.TransactionClient) {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(731490126)::text`;
  }

  normalize(input: AthleteIdentityInput) {
    for (const value of [input.fullName, input.documentNumber, input.address, input.phone]) {
      if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 500)) {
        throw new BadRequestException('Thông tin định danh VĐV không hợp lệ.');
      }
    }
    const number = document(input.documentNumber);
    if (number && (!input.identityType || (input.identityType === 'CCCD' ? !/^\d{12}$/.test(number) : !/^[A-Z0-9]{5,20}$/.test(number)))) {
      throw new BadRequestException('Số CCCD phải có 12 chữ số; số hộ chiếu phải có 5–20 ký tự chữ hoặc số.');
    }
    const documentHash = number ? hash(`${input.identityType}:${input.identityType === 'PASSPORT' ? input.countryId : ''}:${number}`) : null;
    return {
      documentHash,
      addressHash: text(input.address) ? hash(text(input.address)) : null,
      ...(number && input.identityType === 'CCCD' ? { cccdHash: documentHash, cccdEncrypted: this.encrypt(number, 'CCCD') } : {}),
      ...(number && input.identityType === 'PASSPORT' ? { passportHash: documentHash, passportEncrypted: this.encrypt(number, 'PASSPORT') } : {}),
    };
  }

  async assertNew(transaction: Prisma.TransactionClient, input: AthleteIdentityInput, excludeId?: string) {
    const keys = this.normalize(input);
    const number = document(input.documentNumber);
    const legacyIds = number ? await transaction.$queryRaw<{ athleteId: string }[]>`
      SELECT DISTINCT m."athleteId" FROM "AthleteMedia" m
      JOIN "Athlete" a ON a.id = m."athleteId"
      WHERE m.type::text = ${input.identityType === 'PASSPORT' ? 'PASSPORT' : 'CCCD_FRONT'}
        AND (${input.identityType !== 'PASSPORT'} OR a."countryId" = ${input.countryId})
        AND regexp_replace(upper(COALESCE(m."ocrData"->'confirmedFields'->>'documentNumber',
          m."ocrData"->'fields'->>'documentNumber', '')), '[[:space:].-]', '', 'g') = ${number}
    ` : [];
    const date = input.birthDate;
    const dayStart = date ? new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`) : undefined;
    const candidates = await transaction.athlete.findMany({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [
          ...(keys.documentHash ? [{ identity: { documentHash: keys.documentHash } }] : []),
          ...(keys.documentHash ? [{ identity: { cccdHash: keys.documentHash } }, { identity: { passportHash: keys.documentHash } }] : []),
          ...(legacyIds.length ? [{ id: { in: legacyIds.map((row) => row.athleteId) } }] : []),
          ...(dayStart ? [{ birthDate: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400000) } }] : []),
        ],
      },
      select: { id: true, fullName: true, birthDate: true, gender: true, countryId: true, federationId: true,
        phone: true, identity: true, media: { where: { type: { in: [AthleteMediaType.CCCD_FRONT, AthleteMediaType.PASSPORT] } }, select: { ocrData: true } } },
    });
    for (const candidate of candidates) {
      if ((keys.documentHash && [candidate.identity?.documentHash, candidate.identity?.cccdHash, candidate.identity?.passportHash].includes(keys.documentHash)) || legacyIds.some((row) => row.athleteId === candidate.id)) {
        throw this.conflict('Giấy tờ định danh đã được sử dụng cho một hồ sơ VĐV.');
      }
      if (!dayStart || candidate.birthDate?.toISOString().slice(0, 10) !== dayStart.toISOString().slice(0, 10)
        || text(candidate.fullName) !== text(input.fullName) || candidate.gender !== input.gender || candidate.countryId !== input.countryId) continue;
      const addressMatch = keys.addressHash && (candidate.identity?.addressHash === keys.addressHash || candidate.media.some((media) => {
        const data = media.ocrData as { confirmedFields?: { address?: string }; fields?: { address?: string } } | null;
        const address = text(data?.confirmedFields?.address || data?.fields?.address);
        return address && hash(address) === keys.addressHash;
      }));
      const phoneMatch = phone(input.phone) && phone(candidate.phone) === phone(input.phone);
      const hasLegacyIdentity = candidate.media.some((media) => {
        const data = media.ocrData as { confirmedFields?: { documentNumber?: string; address?: string }; fields?: { documentNumber?: string; address?: string } } | null;
        return data?.confirmedFields?.documentNumber || data?.fields?.documentNumber
          || data?.confirmedFields?.address || data?.fields?.address;
      });
      const legacyMatch = !hasLegacyIdentity && !candidate.identity?.documentHash && !candidate.identity?.addressHash
        && !candidate.phone && (candidate.federationId || null) === (input.federationId || null);
      if (addressMatch || phoneMatch || legacyMatch) throw this.conflict('Thông tin cá nhân trùng với hồ sơ VĐV đã có.');
    }
    return keys;
  }

  async findDocumentMatches(transaction: Prisma.TransactionClient, input: AthleteIdentityInput) {
    const keys = this.normalize(input);
    const number = document(input.documentNumber);
    if (!keys.documentHash || !number) throw new BadRequestException('Vui lòng nhập số giấy tờ.');
    const legacyIds = await transaction.$queryRaw<{ athleteId: string }[]>`
      SELECT DISTINCT m."athleteId" FROM "AthleteMedia" m JOIN "Athlete" a ON a.id = m."athleteId"
      WHERE m.type::text = ${input.identityType === 'PASSPORT' ? 'PASSPORT' : 'CCCD_FRONT'}
      AND (${input.identityType !== 'PASSPORT'} OR a."countryId" = ${input.countryId})
      AND regexp_replace(upper(COALESCE(m."ocrData"->'confirmedFields'->>'documentNumber',
        m."ocrData"->'fields'->>'documentNumber', '')), '[[:space:].-]', '', 'g') = ${number}
    `;
    return transaction.athlete.findMany({
      where: { OR: [
        { identity: { documentHash: keys.documentHash } }, { identity: { cccdHash: keys.documentHash } },
        { identity: { passportHash: keys.documentHash } }, { id: { in: legacyIds.map((row) => row.athleteId) } },
      ] },
      include: {
        participantAccount: { select: { phone: true } },
        country: { select: { name: true } }, federation: { select: { name: true } },
        media: { select: { type: true, verificationStatus: true, storageKey: true, mimeType: true, size: true } },
        publicRegistrations: { include: { submission: { select: { contactPhone: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private conflict(reason: string) {
    return new ConflictException({ code: 'DUPLICATE_ATHLETE',
      message: `${reason} Không tiếp nhận hồ sơ mới. Vui lòng dùng hồ sơ hiện có để đăng ký nội dung thi đấu hoặc liên hệ ban tổ chức.` });
  }
}
