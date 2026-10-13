import type { ImageVariant } from '../storage/image-variant';
import { resolveEventAgeLimits } from '../events/event-age-limits';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountVerificationStatus,
  AthleteMediaType,
  DocumentOcrStatus,
  DocumentVerificationStatus,
  EntryStatus,
  EntryType,
  Gender,
  PaymentMode,
  PaymentStatus,
  PaymentTransactionStatus,
  Prisma,
  RegistrationStatus,
  RegistrationSubmissionType,
  SportDataAccountType,
} from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import * as nodemailer from 'nodemailer';
import type { SignOptions } from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  ConfirmIdentityOcrDto,
  AdminCreateRegistrationDto,
  CreatePublicRegistrationDto,
  ParticipantLoginDto,
  ParticipantForgotPasswordDto,
  ParticipantResetPasswordDto,
  ParticipantRegisterDto,
  UpdateParticipantProfileDto,
} from './dto/participant.dto';
import { IdentityOcrService, type IdentityOcrFields, type IdentityOcrResult } from './identity-ocr.service';
import { TicketEmailQueueService } from './ticket-email-queue.service';
import { TicketNotFoundException, TicketNotIssuedException } from './ticket-availability.exceptions';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AthleteIdentityService } from '../athletes/athlete-identity.service';
import { CheckAthleteIdentityDto } from './dto/check-athlete-identity.dto';
import { LookupAthleteDto } from './dto/lookup-athlete.dto';
import { registrationDisciplineKey } from './registration-discipline';
import { registrationMediaSelect, registrationMediaState } from './registration-media-state';
import { usableAccountMedia } from './participant-account-profile';

const mediaSelect = {
  id: true,
  type: true,
  mimeType: true,
  size: true,
  verificationStatus: true,
  verificationNote: true,
  verifiedAt: true,
  ocrStatus: true,
  ocrProvider: true,
  ocrConfidence: true,
  ocrData: true,
  updatedAt: true,
} as const;

type GuestAthleteInput = {
  reuseToken?: string;
  profileConfirmed?: boolean;
  documentNumber?: string;
  address?: string;
  phone?: string;
  fullName?: string;
  birthDate?: string;
  gender?: Gender;
  countryId?: string;
  federationId?: string;
  categoryId?: string;
  categoryIds?: string[];
  weight?: number;
  height?: number;
  identityType?: 'CCCD' | 'PASSPORT';
  identityOcr?: {
    provider?: string;
    confidence?: number | null;
    fields?: IdentityOcrFields;
    fieldConfidence?: Record<string, number>;
    userConfirmed?: boolean;
  };
  mediaUploads?: {
    avatar?: GuestMediaUploadReference;
    cccdFront?: GuestMediaUploadReference;
    cccdBack?: GuestMediaUploadReference;
    passport?: GuestMediaUploadReference;
  };
};

type GuestMediaUploadReference = {
  id?: string;
  token?: string;
};

type RegistrationMediaFile = Pick<Express.Multer.File, 'mimetype' | 'size'> & {
  buffer?: Buffer;
  storageKey?: string;
};

type GuestRegistrationPayload = {
  eventId?: string;
  type?: RegistrationSubmissionType;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  organizationName?: string;
  athletes?: GuestAthleteInput[];
};

@Injectable()
export class ParticipantsService {
  private readonly logger = new Logger(ParticipantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jwtService: JwtService,
    private readonly identityOcr: IdentityOcrService,
    private readonly ticketEmailQueue: TicketEmailQueueService,
    private readonly systemSettings: SystemSettingsService,
    private readonly notifications: NotificationsService,
    private readonly athleteIdentity: AthleteIdentityService,
  ) {}

  async checkAthleteIdentity(dto: CheckAthleteIdentityDto) {
    await this.prisma.$transaction(async (transaction) => {
      await this.athleteIdentity.assertNew(transaction, {
        ...dto, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      });
    });
    return { available: true };
  }

  private normalizedContactPhone(value?: string | null) {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('84') ? `0${digits.slice(2)}` : digits;
  }

  async lookupAthlete(dto: LookupAthleteDto) {
    const event = await this.prisma.event.findUnique({ where: { id: dto.eventId }, select: { isPublished: true } });
    if (!event?.isPublished) throw new NotFoundException('Sự kiện không tồn tại hoặc chưa công khai');
    const input = { ...dto, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      fullName: dto.fullName || '', gender: Gender.MIXED, countryId: dto.countryId || '' };
    const matches = await this.prisma.$transaction((transaction) => this.athleteIdentity.findDocumentMatches(transaction, input));
    if (!matches.length) return { status: 'NEW' as const };
    const phone = this.normalizedContactPhone(dto.phone);
    const normalizedName = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
    const authorized = matches.filter((athlete) => {
      const phones = [athlete.phone, athlete.participantAccount?.phone,
        ...athlete.publicRegistrations.map((registration) => registration.submission?.contactPhone)];
      const matchesPhone = phone && phones.some((value) => this.normalizedContactPhone(value) === phone);
      const matchesPersonal = dto.fullName && dto.birthDate && normalizedName(dto.fullName) === normalizedName(athlete.fullName)
        && athlete.birthDate?.toISOString().slice(0, 10) === new Date(dto.birthDate).toISOString().slice(0, 10);
      return matchesPhone || matchesPersonal;
    });
    if (!authorized.length) return { status: 'VERIFY_CONTACT' as const,
      message: 'Đã có hồ sơ theo số giấy tờ này. Nhập SĐT liên hệ đã dùng trước đây hoặc họ tên và ngày sinh để xác nhận hồ sơ.' };
    const athlete = authorized.find((item) => item.publicRegistrations.some((registration) => registration.eventId === dto.eventId)) || authorized[0];
    const registrations = athlete.publicRegistrations.filter((item) => item.eventId === dto.eventId);
    const registration = registrations[0];
    const keys = this.athleteIdentity.normalize(input);
    const reuseToken = this.jwtService.sign({ purpose: 'reuse-athlete', athleteId: athlete.id,
      eventId: dto.eventId, documentHash: keys.documentHash, phone }, { expiresIn: '30m' });
    return {
      status: registration ? 'REGISTERED' as const : 'FOUND' as const,
      reuseToken,
      athlete: { fullName: athlete.fullName, birthDate: athlete.birthDate?.toISOString().slice(0, 10),
        gender: athlete.gender, countryId: athlete.countryId, federationId: athlete.federationId,
        countryName: athlete.country.name, federationName: athlete.federation?.name,
        weight: athlete.weight, height: athlete.height,
        hasAvatar: registrationMediaState(athlete.media, dto.identityType).hasAvatar,
        hasIdentity: registrationMediaState(athlete.media, dto.identityType).hasIdentityDocuments },
      registrations: registrations.map((item) => ({ ticketCode: item.ticketCode, status: item.status,
        paymentStatus: item.paymentStatus, categoryId: item.categoryId, feeAmount: item.feeAmount })),
      registration: registration ? { ticketCode: registration.ticketCode, status: registration.status,
        paymentStatus: registration.paymentStatus, categoryId: registration.categoryId,
        feeAmount: registration.feeAmount } : undefined,
    };
  }

  private async resolveReuse(athlete: GuestAthleteInput, eventId: string, contactPhone: string) {
    if (!athlete.reuseToken || athlete.profileConfirmed !== true) throw new BadRequestException('Vui lòng xác nhận thông tin hồ sơ.');
    let token: { purpose?: string; athleteId?: string; eventId?: string; documentHash?: string; phone?: string };
    try { token = this.jwtService.verify(athlete.reuseToken); }
    catch { throw new BadRequestException('Phiên xác nhận đã hết hạn. Vui lòng kiểm tra lại số giấy tờ.'); }
    const input = { ...athlete, birthDate: athlete.birthDate ? new Date(athlete.birthDate) : undefined,
      fullName: athlete.fullName || '', gender: athlete.gender || Gender.MIXED, countryId: athlete.countryId || '' };
    const keys = this.athleteIdentity.normalize(input);
    if (token.purpose !== 'reuse-athlete' || token.eventId !== eventId || token.documentHash !== keys.documentHash
      || token.phone !== this.normalizedContactPhone(athlete.phone || contactPhone)) {
      throw new BadRequestException('Thông tin xác nhận đã thay đổi. Vui lòng kiểm tra lại số giấy tờ.');
    }
    const matches = await this.prisma.$transaction((transaction) => this.athleteIdentity.findDocumentMatches(transaction, input));
    const existing = matches.find((item) => item.id === token.athleteId);
    if (!existing) throw new BadRequestException('Hồ sơ đã thay đổi. Vui lòng kiểm tra lại số giấy tờ.');
    return existing;
  }

  async register(dto: ParticipantRegisterDto) {
    if (dto.accountTypes && dto.accountTypes.length !== 1) {
      throw new BadRequestException('Mỗi tài khoản chỉ được chọn một loại');
    }
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.participantAccount.findUnique({ where: { email } })) {
      throw new ConflictException('Email này đã được đăng ký');
    }
    await this.validateAffiliation(dto.countryId, dto.federationId);
    const input = { ...dto, fullName: dto.displayName, birthDate: new Date(dto.birthDate) };
    const identity = this.athleteIdentity.normalize(input);
    if (!identity.documentHash) throw new BadRequestException('Vui lòng nhập số CCCD hoặc hộ chiếu.');
    const password = await bcrypt.hash(dto.password, 12);
    const account = await this.prisma.$transaction(async (transaction) => {
      await this.athleteIdentity.lock(transaction);
      if (await transaction.participantAccount.findUnique({ where: { email } })) {
        throw new ConflictException('Email này đã được đăng ký');
      }
      if (await transaction.participantAccount.findUnique({ where: { documentHash: identity.documentHash } })) {
        throw new ConflictException('Giấy tờ này đã được liên kết với một tài khoản SportData.');
      }
      const matches = await this.athleteIdentity.findDocumentMatches(transaction, input);
      if (matches.length > 1) throw new ConflictException('Có nhiều hồ sơ trùng giấy tờ. Vui lòng liên hệ ban tổ chức để kiểm tra.');
      const athlete = matches[0];
      if (athlete?.participantAccountId) throw new ConflictException('Hồ sơ VĐV này đã được liên kết với một tài khoản SportData.');
      const normalizedName = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
      if (athlete && (normalizedName(athlete.fullName) !== normalizedName(dto.displayName)
        || athlete.birthDate?.toISOString().slice(0, 10) !== input.birthDate.toISOString().slice(0, 10))) {
        throw new ConflictException('Họ tên và ngày sinh không khớp hồ sơ theo giấy tờ. Vui lòng kiểm tra hoặc liên hệ ban tổ chức.');
      }
      return transaction.participantAccount.create({
        data: {
          email, password,
          displayName: athlete?.fullName || dto.displayName.trim(),
          phone: athlete?.phone || dto.phone?.trim() || null,
          gender: athlete?.gender || dto.gender, birthDate: athlete?.birthDate || input.birthDate,
          countryId: athlete?.countryId || dto.countryId,
          federationId: athlete?.federationId || dto.federationId || null,
          weight: athlete?.weight ?? dto.weight,
          height: athlete?.height,
          identityType: dto.identityType, documentHash: identity.documentHash,
          documentEncrypted: dto.identityType === 'CCCD' ? identity.cccdEncrypted : identity.passportEncrypted,
          accountType: dto.accountTypes?.[0] || SportDataAccountType.ATHLETE,
          accountTypes: dto.accountTypes || [SportDataAccountType.ATHLETE],
          verificationStatus: dto.accountTypes?.includes(SportDataAccountType.TEAM_LEADER) && (athlete?.federationId || dto.federationId)
            ? AccountVerificationStatus.PENDING : AccountVerificationStatus.VERIFIED,
          ...(athlete ? { athlete: { connect: { id: athlete.id } } } : {}),
        },
        select: { id: true, email: true, displayName: true, accountType: true, accountTypes: true, federationId: true, verificationStatus: true },
      });
    });
    return { account, accessToken: this.sign(account.id, account.email) };
  }

  async login(dto: ParticipantLoginDto) {
    const account = await this.prisma.participantAccount.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (!account || !(await bcrypt.compare(dto.password, account.password))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    if (!account.isActive) throw new UnauthorizedException('Tài khoản đã bị vô hiệu hóa');
    if (dto.accountType && !account.accountTypes.includes(dto.accountType)) {
      throw new UnauthorizedException('Loại tài khoản không phù hợp. Vui lòng đăng nhập bằng Tài khoản SportData.');
    }
    return {
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        accountType: account.accountType,
        accountTypes: account.accountTypes,
        verificationStatus: account.verificationStatus,
        federationId: account.federationId,
      },
      accessToken: this.sign(account.id, account.email),
    };
  }

  async forgotPassword(dto: ParticipantForgotPasswordDto) {
    const account = await this.prisma.participantAccount.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    let resetUrl: string | undefined;

    if (account?.isActive) {
      const requestedRecently = account.resetPasswordRequestedAt
        && Date.now() - account.resetPasswordRequestedAt.getTime() < 60 * 1000;

      if (!requestedRecently) {
        const token = randomBytes(32).toString('hex');
        const ttlMinutes = Math.max(5, Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30));
        await this.prisma.participantAccount.update({
          where: { id: account.id },
          data: {
            resetPasswordTokenHash: this.hashResetToken(token),
            resetPasswordExpiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
            resetPasswordRequestedAt: new Date(),
          },
        });

        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
        resetUrl = `${frontendUrl}/account/reset-password?token=${encodeURIComponent(token)}`;
        try {
          await this.sendResetEmail(account.email, resetUrl, ttlMinutes);
        } catch (error: any) {
          this.logger.warn(`Không thể gửi email đặt lại mật khẩu tài khoản SportData: ${error?.message || error}`);
        }
      }
    }

    return {
      message: 'Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi tới email đã đăng ký.',
      ...(process.env.NODE_ENV !== 'production' && resetUrl ? { resetUrl } : {}),
    };
  }

  async resetPassword(dto: ParticipantResetPasswordDto) {
    const tokenHash = this.hashResetToken(dto.token);
    const now = new Date();
    const account = await this.prisma.participantAccount.findFirst({
      where: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: { gt: now },
        isActive: true,
      },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
    }

    const result = await this.prisma.participantAccount.updateMany({
      where: {
        id: account.id,
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: { gt: now },
        isActive: true,
      },
      data: {
        password: await bcrypt.hash(dto.password, 12),
        passwordChangedAt: now,
        resetPasswordTokenHash: null,
        resetPasswordExpiresAt: null,
        resetPasswordRequestedAt: null,
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
    }
    return { message: 'Mật khẩu đã được cập nhật. Bạn có thể đăng nhập ngay.' };
  }

  async getTeamProfile(accountId: string) {
    const account = await this.prisma.participantAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        representativePosition: true,
        accountType: true,
        accountTypes: true,
        verificationStatus: true,
        createdAt: true,
        federation: {
          include: {
            country: true,
            _count: { select: { athletes: true, participatingEvents: true } },
          },
        },
        submissions: {
          include: {
            event: { select: { id: true, name: true, startDate: true, endDate: true, location: true } },
            registrations: {
              select: { id: true, ticketCode: true, status: true, athlete: { select: { fullName: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!account || !account.accountTypes.includes(SportDataAccountType.TEAM_LEADER) || !account.federation) {
      throw new ForbiddenException('Tài khoản không có quyền đại diện liên đoàn/CLB');
    }
    return account;
  }

  async listAccounts() {
    return this.prisma.participantAccount.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        accountType: true, accountTypes: true,
        representativePosition: true,
        verificationStatus: true,
        isActive: true,
        createdAt: true,
        federation: { include: { country: true } },
      },
      orderBy: [{ verificationStatus: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async updateAccountStatus(accountId: string, status: AccountVerificationStatus) {
    const account = await this.prisma.participantAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('Không tìm thấy tài khoản SportData');
    }
    return this.prisma.participantAccount.update({
      where: { id: accountId },
      data: { verificationStatus: status },
      select: { id: true, email: true, displayName: true, verificationStatus: true, federationId: true },
    });
  }

  async updateAccountTypes(accountId: string, accountTypes: SportDataAccountType[]) {
    if (accountTypes.length !== 1) {
      throw new BadRequestException('Mỗi tài khoản chỉ được chọn một loại');
    }
    const account = await this.prisma.participantAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản SportData');
    return this.prisma.participantAccount.update({
      where: { id: accountId },
      data: {
        accountTypes, accountType: accountTypes[0],
        ...(accountTypes.includes(SportDataAccountType.TEAM_LEADER)
          && !account.accountTypes.includes(SportDataAccountType.TEAM_LEADER) && account.federationId
          ? { verificationStatus: AccountVerificationStatus.PENDING } : {}),
      },
      select: { id: true, accountTypes: true, accountType: true, verificationStatus: true },
    });
  }

  async getProfile(accountId: string) {
    const account = await this.prisma.participantAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        gender: true, birthDate: true, countryId: true, federationId: true,
        weight: true, height: true, identityType: true, documentHash: true,
        createdAt: true,
        accountType: true,
        accountTypes: true,
        athlete: {
          include: {
            country: true,
            federation: { include: { country: true } },
            media: { select: mediaSelect, orderBy: { type: 'asc' } },
          },
        },
      },
    });
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản SportData');
    if (!account.athlete && !account.documentHash && account.accountTypes.includes(SportDataAccountType.ATHLETE)) {
      const candidates = await this.prisma.athlete.findMany({
        where: {
          email: { equals: account.email, mode: 'insensitive' },
          participantAccountId: null,
        },
        select: { id: true },
        take: 2,
      });
      if (candidates.length === 1) {
        await this.prisma.athlete.update({
          where: { id: candidates[0].id },
          data: { participantAccountId: accountId },
        });
        return this.getProfile(accountId);
      }
    }
    const { documentHash, ...publicAccount } = account;
    if (account.athlete) return { ...publicAccount, hasAthleteProfile: true, athlete: account.athlete };
    const country = account.countryId ? await this.prisma.country.findUniqueOrThrow({ where: { id: account.countryId } })
      : { id: '', code: '', name: 'Chưa cập nhật' };
    const federation = account.federationId ? await this.prisma.federation.findUnique({
      where: { id: account.federationId }, include: { country: true },
    }) : null;
    // Compatibility projection of personal account data, never persisted as an Athlete.
    const athlete = {
      id: '', fullName: account.displayName, ...this.splitName(account.displayName),
      email: account.email, phone: account.phone, gender: account.gender || Gender.MIXED,
      birthDate: account.birthDate, countryId: account.countryId || country.id, federationId: account.federationId,
      weight: account.weight, height: account.height, photoUrl: null, country, federation, media: [],
    };
    return { ...publicAccount, hasAthleteProfile: false, athlete };
  }

  private async getAthleteProfile(accountId: string) {
    const profile = await this.getProfile(accountId);
    if (!profile.hasAthleteProfile) throw new BadRequestException('Vui lòng đăng ký tham dự sự kiện để tạo hồ sơ VĐV.');
    return profile;
  }

  async updateProfile(accountId: string, dto: UpdateParticipantProfileDto) {
    const account = await this.getProfile(accountId);
    const countryId = dto.countryId || account.athlete.countryId;
    const federationId = dto.federationId === undefined
      ? account.athlete.federationId
      : dto.federationId || null;
    await this.validateAffiliation(countryId, federationId || undefined);
    const unitChanged = dto.federationId !== undefined && federationId !== account.federationId;
    const verificationChange = unitChanged && account.accountTypes.includes(SportDataAccountType.TEAM_LEADER)
      ? { verificationStatus: AccountVerificationStatus.PENDING } : {};
    const displayName = dto.displayName?.trim() || account.displayName;
    if (dto.countryId && dto.countryId !== account.athlete.countryId && account.identityType === 'PASSPORT') {
      throw new BadRequestException('Không thể thay đổi quốc gia cấp hộ chiếu của tài khoản.');
    }
    if (!account.hasAthleteProfile) {
      await this.prisma.participantAccount.update({ where: { id: accountId }, data: {
        displayName, phone: dto.phone !== undefined ? dto.phone.trim() || null : account.phone,
        countryId, federationId, gender: dto.gender, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        weight: dto.weight, height: dto.height,
        ...verificationChange,
      } });
      return this.getProfile(accountId);
    }
    const name = this.splitName(displayName);
    await this.prisma.$transaction(async (transaction) => {
      await this.athleteIdentity.lock(transaction);
      await this.athleteIdentity.assertNew(transaction, {
        ...account.athlete, fullName: displayName,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : account.athlete.birthDate,
        gender: dto.gender || account.athlete.gender, countryId, federationId,
        phone: dto.phone !== undefined ? dto.phone : account.phone,
      }, account.athlete.id);
      await transaction.participantAccount.update({
        where: { id: accountId },
        data: {
          ...(dto.displayName ? { displayName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
          countryId, federationId,
          ...verificationChange,
        },
      });
      await transaction.athlete.update({
        where: { id: account.athlete.id },
        data: {
          email: account.email,
          phone: dto.phone !== undefined ? dto.phone?.trim() || null : account.phone,
          ...(dto.displayName ? { fullName: displayName, ...name } : {}),
          ...(dto.gender ? { gender: dto.gender } : {}),
          ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}),
          ...(dto.countryId ? { countryId: dto.countryId } : {}),
          ...(dto.federationId !== undefined ? { federationId } : {}),
          ...(dto.weight !== undefined ? { weight: dto.weight } : {}),
          ...(dto.height !== undefined ? { height: dto.height } : {}),
        },
      });
    });
    return this.getProfile(accountId);
  }

  async upsertMedia(accountId: string, type: AthleteMediaType, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Vui lòng chọn tệp cần tải lên');
    const profile = await this.getAthleteProfile(accountId);
    this.validateFile(type, file);
    const settings = await this.systemSettings.get();
    const autoVerify = type !== AthleteMediaType.AVATAR && !settings.values.identityOcrEnabled;
    const ocr = type === AthleteMediaType.AVATAR || autoVerify ? null : await this.identityOcr.read(file, type);
    const verificationStatus = type === AthleteMediaType.AVATAR
      ? null
      : autoVerify
        ? DocumentVerificationStatus.VERIFIED
        : DocumentVerificationStatus.PENDING;
    const previous = await this.prisma.athleteMedia.findUnique({
      where: { athleteId_type: { athleteId: profile.athlete.id, type } },
      select: { storageKey: true },
    });
    const storedMedia = await this.storage.withUpload(file, type === AthleteMediaType.AVATAR ? 'athletes/avatars' : 'athletes/documents', previous?.storageKey, (storageKey, stored) => this.prisma.athleteMedia.upsert({
      where: { athleteId_type: { athleteId: profile.athlete.id, type } },
      create: {
        athleteId: profile.athlete.id,
        type,
        storageKey,
        mimeType: file.mimetype,
        size: stored.size,
        verificationStatus,
        verificationNote: autoVerify ? 'Tự động duyệt vì OCR CCCD / Hộ chiếu đang tắt.' : null,
        verifiedAt: autoVerify ? new Date() : null,
        verifiedBy: autoVerify ? 'SYSTEM:OCR_DISABLED' : null,
        ...(ocr ? this.ocrPersistence(ocr) : {}),
      },
      update: {
        storageKey,
        mimeType: file.mimetype,
        size: stored.size,
        verificationStatus,
        verificationNote: autoVerify ? 'Tự động duyệt vì OCR CCCD / Hộ chiếu đang tắt.' : null,
        verifiedAt: autoVerify ? new Date() : null,
        verifiedBy: autoVerify ? 'SYSTEM:OCR_DISABLED' : null,
        ...(ocr ? this.ocrPersistence(ocr) : {
          ocrStatus: DocumentOcrStatus.NOT_REQUESTED,
          ocrProvider: null,
          ocrConfidence: null,
          ocrData: Prisma.DbNull,
        }),
      },
    }));
    if (type === AthleteMediaType.AVATAR) {
      await this.prisma.athlete.update({
        where: { id: profile.athlete.id },
        data: { photoUrl: `/api/participant-auth/avatar/${profile.athlete.id}` },
      });
    }
    return { type, mimeType: storedMedia.mimeType, size: storedMedia.size, verificationStatus, ocr };
  }

  async previewIdentityOcr(type: AthleteMediaType, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh giấy tờ');
    if (type !== AthleteMediaType.CCCD_FRONT && type !== AthleteMediaType.CCCD_BACK && type !== AthleteMediaType.PASSPORT) {
      throw new BadRequestException('Loại giấy tờ không hợp lệ');
    }
    this.validateFile(type, file);
    return this.identityOcr.read(file, type);
  }

  async confirmIdentityOcr(accountId: string, type: AthleteMediaType, dto: ConfirmIdentityOcrDto) {
    if (type === AthleteMediaType.AVATAR) throw new BadRequestException('Ảnh đại diện không có dữ liệu OCR');
    const profile = await this.getAthleteProfile(accountId);
    const media = await this.prisma.athleteMedia.findUnique({
      where: { athleteId_type: { athleteId: profile.athlete.id, type } },
    });
    if (!media) throw new NotFoundException('Chưa có giấy tờ để xác nhận');
    if (media.ocrStatus !== DocumentOcrStatus.COMPLETED) {
      throw new BadRequestException('Giấy tờ chưa được OCR thành công');
    }

    const { applyToProfile, ...confirmedFields } = dto;
    const previous = media.ocrData && typeof media.ocrData === 'object' && !Array.isArray(media.ocrData)
      ? media.ocrData as Record<string, unknown>
      : {};
    await this.prisma.$transaction(async (transaction) => {
      await this.athleteIdentity.lock(transaction);
      const identity = await this.athleteIdentity.assertNew(transaction, {
        fullName: applyToProfile && confirmedFields.fullName ? confirmedFields.fullName : profile.athlete.fullName,
        birthDate: applyToProfile && confirmedFields.dateOfBirth ? new Date(confirmedFields.dateOfBirth) : profile.athlete.birthDate,
        gender: applyToProfile ? this.ocrGender(confirmedFields.sex) || profile.athlete.gender : profile.athlete.gender,
        countryId: profile.athlete.countryId, federationId: profile.athlete.federationId,
        phone: profile.athlete.phone, identityType: type === AthleteMediaType.PASSPORT ? 'PASSPORT' : 'CCCD',
        documentNumber: confirmedFields.documentNumber, address: confirmedFields.address,
      }, profile.athlete.id);
      await transaction.athleteIdentity.upsert({
        where: { athleteId: profile.athlete.id },
        create: { athleteId: profile.athlete.id, ...identity },
        update: {
          ...(identity.documentHash ? { documentHash: identity.documentHash } : {}),
          cccdHash: identity.cccdHash,
          cccdEncrypted: identity.cccdEncrypted,
          passportHash: identity.passportHash,
          passportEncrypted: identity.passportEncrypted,
          ...(identity.addressHash ? { addressHash: identity.addressHash } : {}),
        },
      });
      await transaction.athleteMedia.update({
        where: { athleteId_type: { athleteId: profile.athlete.id, type } },
        data: {
          ocrData: {
            ...previous,
            confirmedFields,
            userConfirmed: true,
            confirmedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      if (applyToProfile) {
        const fullName = confirmedFields.fullName?.trim();
        const gender = this.ocrGender(confirmedFields.sex);
        await transaction.athlete.update({
          where: { id: profile.athlete.id },
          data: {
            ...(fullName ? { fullName, ...this.splitName(fullName) } : {}),
            ...(confirmedFields.dateOfBirth ? { birthDate: new Date(confirmedFields.dateOfBirth) } : {}),
            ...(gender ? { gender } : {}),
          },
        });
        if (fullName) {
          await transaction.participantAccount.update({ where: { id: accountId }, data: { displayName: fullName } });
        }
      }
    });
    return this.getProfile(accountId);
  }

  async updateDocumentVerification(
    athleteId: string,
    type: AthleteMediaType,
    status: DocumentVerificationStatus,
    note?: string,
    verifiedBy?: string,
  ) {
    if (type === AthleteMediaType.AVATAR) {
      throw new BadRequestException('Ảnh đại diện không phải giấy tờ định danh');
    }
    const media = await this.prisma.athleteMedia.findUnique({
      where: { athleteId_type: { athleteId, type } },
    });
    if (!media) throw new NotFoundException('Chưa có giấy tờ này');
    return this.prisma.athleteMedia.update({
      where: { athleteId_type: { athleteId, type } },
      data: {
        verificationStatus: status,
        verificationNote: note?.trim() || null,
        verifiedAt: status === DocumentVerificationStatus.VERIFIED ? new Date() : null,
        verifiedBy: status === DocumentVerificationStatus.VERIFIED ? verifiedBy : null,
      },
      select: mediaSelect,
    });
  }

  async getOwnMedia(accountId: string, type: AthleteMediaType, variant?: ImageVariant) {
    const profile = await this.getAthleteProfile(accountId);
    return this.getMedia(profile.athlete.id, type, variant);
  }

  async getAvatar(athleteId: string, variant?: ImageVariant): Promise<{ url: string } | { data: Buffer; mimeType: string }> {
    const media = await this.prisma.athleteMedia.findUnique({
      where: { athleteId_type: { athleteId, type: AthleteMediaType.AVATAR } },
      select: { storageKey: true, mimeType: true },
    });
    if (!media) throw new NotFoundException('Chưa có ảnh đại diện');
    const url = await this.storage.imageUrl(media.storageKey, variant);
    if (url) return { url };
    return { data: await this.storage.read(media.storageKey), mimeType: media.mimeType };
  }

  async getMedia(athleteId: string, type: AthleteMediaType, variant?: ImageVariant) {
    const media = await this.prisma.athleteMedia.findUnique({
      where: { athleteId_type: { athleteId, type } },
    });
    if (!media) throw new NotFoundException('Chưa có tệp này');
    return { ...media, data: await this.storage.read(media.storageKey, variant) };
  }

  async createMediaUpload(typeText: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Chưa chọn tệp cần tải lên');
    const type = Object.values(AthleteMediaType).includes(typeText as AthleteMediaType)
      ? typeText as AthleteMediaType
      : null;
    if (!type || ![
      AthleteMediaType.AVATAR,
      AthleteMediaType.CCCD_FRONT,
      AthleteMediaType.CCCD_BACK,
      AthleteMediaType.PASSPORT,
    ].includes(type)) {
      throw new BadRequestException('Loại tệp đăng ký không hợp lệ');
    }
    this.validateFile(type, file);

    const now = new Date();
    const expired = await this.prisma.$queryRaw<Array<{ storageKey: string | null }>>`
      DELETE FROM "ParticipantMediaUpload" WHERE "expiresAt" <= ${now} RETURNING "storageKey"
    `;
    for (const upload of expired) await this.storage.deleteQuietly(upload.storageKey);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    const upload = await this.storage.withUpload(file, `participant-uploads/${type.toLowerCase()}`, null, (storageKey, stored) => this.prisma.participantMediaUpload.create({
      data: {
        tokenHash: this.hashResetToken(token),
        type,
        storageKey,
        mimeType: file.mimetype,
        size: stored.size,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    }));
    return { ...upload, token };
  }

  async createGuestRegistrations(
    payloadText: string,
    files: Express.Multer.File[],
    submittingAccountId?: string,
    requireTeamLeader = false,
  ) {
    let payload: GuestRegistrationPayload;
    try {
      payload = JSON.parse(payloadText || '{}') as GuestRegistrationPayload;
    } catch {
      throw new BadRequestException('Dữ liệu đăng ký không hợp lệ');
    }

    const submittingAccount = submittingAccountId
      ? await this.prisma.participantAccount.findUnique({
          where: { id: submittingAccountId },
          include: { federation: true },
        })
      : null;
    if (submittingAccountId && !submittingAccount) {
      throw new ForbiddenException('Tài khoản đăng ký không còn tồn tại');
    }
    if (requireTeamLeader && !submittingAccount?.accountTypes.includes(SportDataAccountType.TEAM_LEADER)) {
      throw new ForbiddenException('Chỉ Trưởng đoàn được đăng ký đại diện đơn vị.');
    }
    const federationAccount = requireTeamLeader ? submittingAccount : null;
    if (federationAccount && !federationAccount.federation) {
      throw new ForbiddenException('Tài khoản Trưởng đoàn chưa được gắn với liên đoàn/CLB');
    }
    if (federationAccount && federationAccount.verificationStatus !== AccountVerificationStatus.VERIFIED) {
      throw new ForbiddenException('Tài khoản Trưởng đoàn phải được SportData duyệt trước khi gửi danh sách');
    }

    const eventId = payload.eventId?.trim();
    const contactName = submittingAccount?.displayName || payload.contactName?.trim();
    const contactEmail = submittingAccount?.email || payload.contactEmail?.trim().toLowerCase();
    const contactPhone = submittingAccount?.phone || payload.contactPhone?.trim();
    const athletes = federationAccount
      ? (payload.athletes || []).map((athlete) => ({
          ...athlete,
          countryId: federationAccount.federation!.countryId,
          federationId: federationAccount.federation!.id,
        }))
      : payload.athletes || [];
    if (!eventId) throw new BadRequestException('Thiếu sự kiện đăng ký');
    if (!contactName || contactName.length < 2) throw new BadRequestException('Vui lòng nhập họ tên người đăng ký');
    if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BadRequestException('Email liên hệ không hợp lệ');
    }
    if (!contactPhone || contactPhone.length < 8) throw new BadRequestException('Vui lòng nhập số điện thoại liên hệ');
    if (!athletes.length) throw new BadRequestException('Danh sách đăng ký chưa có vận động viên');
    if (athletes.length > 30) throw new BadRequestException('Mỗi lần chỉ đăng ký tối đa 30 vận động viên');

    const submissionType = federationAccount || athletes.length > 1 || payload.type === RegistrationSubmissionType.GROUP
      ? RegistrationSubmissionType.GROUP
      : RegistrationSubmissionType.INDIVIDUAL;
    const organizationName = federationAccount?.federation?.name || payload.organizationName?.trim() || null;
    if (submissionType === RegistrationSubmissionType.GROUP && !organizationName) {
      throw new BadRequestException('Vui lòng nhập tên đội, CLB hoặc đơn vị đăng ký');
    }

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        categories: { include: { sport: true } },
        participatingFederations: { select: { id: true } },
      },
    });
    if (!event?.isPublished) throw new NotFoundException('Sự kiện không tồn tại hoặc chưa công khai');
    this.validateRegistrationWindow(event);
    const systemSettings = await this.systemSettings.get();
    const autoVerifyIdentity = !systemSettings.values.identityOcrEnabled;
    const reusableAthletes = new Map<string, Awaited<ReturnType<ParticipantsService['resolveReuse']>>>();
    for (const athlete of athletes) {
      if (!athlete.reuseToken) continue;
      const existing = await this.resolveReuse(athlete, eventId, contactPhone);
      reusableAthletes.set(athlete.reuseToken, existing);
      Object.assign(athlete, {
        fullName: existing.fullName, birthDate: existing.birthDate?.toISOString().slice(0, 10),
        gender: existing.gender, countryId: existing.countryId, federationId: existing.federationId || undefined,
        weight: existing.weight ?? undefined, height: existing.height ?? undefined,
      });
    }

    const countries = await this.prisma.country.findMany({
      where: { id: { in: athletes.map((athlete) => athlete.countryId || '').filter(Boolean) } },
      select: { id: true },
    });
    const countryIds = new Set(countries.map((country) => country.id));
    const federationIds = athletes.map((athlete) => athlete.federationId || '').filter(Boolean);
    const federations = federationIds.length
      ? await this.prisma.federation.findMany({
          where: { id: { in: federationIds } },
          select: { id: true, countryId: true },
        })
      : [];
    const federationMap = new Map(federations.map((federation) => [federation.id, federation]));
    const allowedFederations = new Set(event.participatingFederations.map((item) => item.id));
    const categoryMap = new Map(event.categories.map((category) => [category.id, category]));
    const fileMap = new Map(files.map((file) => [file.fieldname, file]));
    const mediaReferences = athletes.flatMap((athlete) => Object.values(athlete.mediaUploads || {}))
      .filter((reference): reference is GuestMediaUploadReference => Boolean(reference?.id));
    const stagedUploads = mediaReferences.length
      ? await this.prisma.participantMediaUpload.findMany({
          where: {
            id: { in: mediaReferences.map((reference) => reference.id!) },
            expiresAt: { gt: new Date() },
          },
        })
      : [];
    const stagedUploadMap = new Map(stagedUploads.map((upload) => [upload.id, upload]));
    const consumedUploadIds = new Set<string>();
    const stagedFile = (
      reference: GuestMediaUploadReference | undefined,
      expectedType: AthleteMediaType,
      athleteIndex: number,
    ): RegistrationMediaFile | undefined => {
      if (!reference) return undefined;
      const upload = reference.id ? stagedUploadMap.get(reference.id) : undefined;
      if (
        !upload
        || !reference.token
        || upload.tokenHash !== this.hashResetToken(reference.token)
        || upload.type !== expectedType
        || !upload.storageKey
      ) {
        throw new BadRequestException(`Vận động viên ${athleteIndex + 1}: tệp tải lên đã hết hạn hoặc không hợp lệ`);
      }
      if (consumedUploadIds.has(upload.id)) {
        throw new BadRequestException('Mỗi tệp tải lên chỉ được sử dụng cho một vận động viên');
      }
      consumedUploadIds.add(upload.id);
      return { storageKey: upload.storageKey, mimetype: upload.mimeType, size: upload.size };
    };

    const prepared = athletes.map((athlete, index) => {
      const existingAthlete = athlete.reuseToken ? reusableAthletes.get(athlete.reuseToken) : undefined;
      const fullName = athlete.fullName?.trim();
      if (!fullName || fullName.length < 2) throw new BadRequestException(`Vận động viên ${index + 1}: thiếu họ tên`);
      const birthDate = athlete.birthDate ? new Date(athlete.birthDate) : null;
      if (!birthDate || Number.isNaN(birthDate.getTime())) {
        throw new BadRequestException(`Vận động viên ${index + 1}: ngày sinh không hợp lệ`);
      }
      if (!athlete.gender || !Object.values(Gender).includes(athlete.gender)) {
        throw new BadRequestException(`Vận động viên ${index + 1}: chưa chọn giới tính`);
      }
      if (!athlete.countryId || !countryIds.has(athlete.countryId)) {
        throw new BadRequestException(`Vận động viên ${index + 1}: quốc gia không hợp lệ`);
      }
      const federation = athlete.federationId ? federationMap.get(athlete.federationId) : undefined;
      if (athlete.federationId && (!federation || federation.countryId !== athlete.countryId)) {
        throw new BadRequestException(`Vận động viên ${index + 1}: đơn vị và quốc gia không phù hợp`);
      }
      if (athlete.federationId) {
        if (allowedFederations.size && !allowedFederations.has(athlete.federationId)) {
          throw new BadRequestException(`Vận động viên ${index + 1}: đơn vị không thuộc danh sách tham gia`);
        }
      } else if (!event.allowIndependentAthletes) {
        throw new BadRequestException(`Vận động viên ${index + 1}: sự kiện không nhận đăng ký tự do`);
      }
      const categoryIds = athlete.categoryIds ?? (athlete.categoryId ? [athlete.categoryId] : []);
      if (!Array.isArray(categoryIds) || !categoryIds.length || categoryIds.length > event.categories.length
        || categoryIds.some((id) => typeof id !== 'string' || !categoryMap.has(id))) {
        throw new BadRequestException(`Vận động viên ${index + 1}: hạng đấu không hợp lệ`);
      }
      const categories = categoryIds.map((id) => categoryMap.get(id)!);
      const disciplineKeys = categories.map(registrationDisciplineKey);
      if (new Set(disciplineKeys).size !== categories.length) {
        throw new BadRequestException(`Vận động viên ${index + 1}: chỉ được chọn một hạng đấu cho mỗi nội dung`);
      }
      const weight = athlete.weight === undefined || athlete.weight === null || athlete.weight === ('' as unknown as number)
        ? null
        : Number(athlete.weight);
      if (weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight > 500)) {
        throw new BadRequestException(`Vận động viên ${index + 1}: cân nặng không hợp lệ`);
      }
      const height = athlete.height === undefined || athlete.height === null || athlete.height === ('' as unknown as number)
        ? null : Number(athlete.height);
      if (height !== null && (!Number.isFinite(height) || height <= 0 || height > 300)) {
        throw new BadRequestException(`Vận động viên ${index + 1}: chiều cao không hợp lệ`);
      }
      for (const category of categories) {
        this.validateAthleteForCategory({ gender: athlete.gender, birthDate, weight }, { ...category, ...resolveEventAgeLimits(event, category) }, event.startDate);
      }

      const cccdFront = fileMap.get(`athlete_${index}_cccdFront`)
        || stagedFile(athlete.mediaUploads?.cccdFront, AthleteMediaType.CCCD_FRONT, index);
      const cccdBack = fileMap.get(`athlete_${index}_cccdBack`)
        || stagedFile(athlete.mediaUploads?.cccdBack, AthleteMediaType.CCCD_BACK, index);
      const passport = fileMap.get(`athlete_${index}_passport`)
        || stagedFile(athlete.mediaUploads?.passport, AthleteMediaType.PASSPORT, index);
      const avatar = fileMap.get(`athlete_${index}_avatar`)
        || stagedFile(athlete.mediaUploads?.avatar, AthleteMediaType.AVATAR, index);
      const identityType: 'CCCD' | 'PASSPORT' = athlete.identityType === 'PASSPORT' ? 'PASSPORT' : 'CCCD';
      const existingState = registrationMediaState(existingAthlete?.media || [], identityType);
      const existingTypes = new Set((existingAthlete?.media || []).filter(usableAccountMedia).map((media) => media.type));
      if (!avatar && !existingState.hasAvatar) {
        throw new BadRequestException(`Vận động viên ${index + 1}: cần ảnh đại diện`);
      }
      if (!existingState.hasIdentityDocuments) {
        if (identityType === 'CCCD' && ((!cccdFront && !existingTypes.has(AthleteMediaType.CCCD_FRONT))
          || (!cccdBack && !existingTypes.has(AthleteMediaType.CCCD_BACK)))) {
          throw new BadRequestException(`Vận động viên ${index + 1}: cần đủ CCCD mặt trước và mặt sau`);
        }
        if (identityType === 'PASSPORT' && !passport && !existingTypes.has(AthleteMediaType.PASSPORT)) {
          throw new BadRequestException(`Vận động viên ${index + 1}: cần ảnh hộ chiếu`);
        }
      }
      if (cccdFront) this.validateFile(AthleteMediaType.CCCD_FRONT, cccdFront);
      if (cccdBack) this.validateFile(AthleteMediaType.CCCD_BACK, cccdBack);
      if (passport) this.validateFile(AthleteMediaType.PASSPORT, passport);
      if (avatar) this.validateFile(AthleteMediaType.AVATAR, avatar);

      return {
        athlete,
        existingAthlete,
        athleteIndex: index,
        categories,
        fullName,
        birthDate,
        weight,
        height,
        identityInput: {
          fullName, birthDate, gender: athlete.gender!, countryId: athlete.countryId!,
          federationId: athlete.federationId, phone: athlete.phone || contactPhone,
          identityType,
          documentNumber: athlete.documentNumber || athlete.identityOcr?.fields?.documentNumber,
          address: athlete.address || athlete.identityOcr?.fields?.address,
        },
        files: { cccdFront, cccdBack, passport, avatar },
      };
    });

    const referenceCode = this.submissionReference();
    const replacedStorageKeys = new Set<string>();
    const persistRegistration = () => this.prisma.$transaction(async (transaction) => {
      await this.athleteIdentity.lock(transaction);
      let submission: { id: string; type: RegistrationSubmissionType } | null = null;
      const ensureSubmission = async () => submission || (submission = await transaction.registrationSubmission.create({
        data: {
          eventId: event.id,
          type: submissionType,
          contactName,
          contactEmail,
          contactPhone,
          organizationName,
          referenceCode,
          accountId: submittingAccount?.id,
        },
      }));

      const registrations = [];
      for (const item of prepared) {
        const existingRegistrations = item.existingAthlete
          ? await transaction.eventRegistration.findMany({
              where: { eventId: event.id, athleteId: item.existingAthlete.id },
              include: { category: true },
            })
          : [];
        for (const category of item.categories) {
          const conflicting = existingRegistrations.find((registered) => registered.categoryId !== category.id
            && registrationDisciplineKey(registered.category) === registrationDisciplineKey(category));
          if (conflicting) {
            throw new ConflictException(`${item.fullName}: đã đăng ký một hạng đấu trong nội dung này (thẻ ${conflicting.ticketCode})`);
          }
        }
        const newCategories = item.categories.filter((category) => !existingRegistrations.some((registered) => registered.categoryId === category.id));
        const media = [
          item.files.avatar && this.mediaCreate(AthleteMediaType.AVATAR, item.files.avatar, false, undefined, autoVerifyIdentity),
          item.files.cccdFront && this.mediaCreate(AthleteMediaType.CCCD_FRONT, item.files.cccdFront, true, item.athlete.identityOcr, autoVerifyIdentity),
          item.files.cccdBack && this.mediaCreate(AthleteMediaType.CCCD_BACK, item.files.cccdBack, true, undefined, autoVerifyIdentity),
          item.files.passport && this.mediaCreate(AthleteMediaType.PASSPORT, item.files.passport, true, item.athlete.identityOcr, autoVerifyIdentity),
        ].filter(Boolean) as Prisma.AthleteMediaCreateWithoutAthleteInput[];
        if (item.existingAthlete) {
          const previousMedia = await transaction.athleteMedia.findMany({ where: { athleteId: item.existingAthlete.id }, select: registrationMediaSelect });
          for (const document of media) {
            const previousKey = previousMedia.find((entry) => entry.type === document.type)?.storageKey;
            await transaction.athleteMedia.upsert({
              where: { athleteId_type: { athleteId: item.existingAthlete.id, type: document.type } },
              create: { ...document, athleteId: item.existingAthlete.id }, update: document,
            });
            if (previousKey && previousKey !== document.storageKey) replacedStorageKeys.add(previousKey);
          }
        }
        if (item.existingAthlete && autoVerifyIdentity) await this.autoVerifyIdentityMedia(item.existingAthlete.id, transaction);
        const existingMedia = item.existingAthlete ? await transaction.athleteMedia.findMany({
          where: { athleteId: item.existingAthlete.id }, select: registrationMediaSelect,
        }) : undefined;
        if (existingMedia) this.assertRequiredRegistrationMedia(registrationMediaState(existingMedia, item.identityInput.identityType));
        for (const category of item.categories) {
          const registered = existingRegistrations.find((registration) => registration.categoryId === category.id);
          if (!registered) continue;
          registrations.push({ id: registered.id, athleteId: registered.athleteId,
            athleteIndex: item.athleteIndex, categoryId: registered.categoryId,
            athleteName: item.fullName, ticketCode: registered.ticketCode,
            status: registered.status, paymentStatus: registered.paymentStatus,
            feeAmount: registered.feeAmount, currency: registered.currency,
            paymentDueAt: registered.paymentStatus === PaymentStatus.PENDING ? this.paymentDueAt(registered.createdAt) : null,
            existing: true });
        }
        if (!newCategories.length) continue;
        if (!item.identityInput.documentNumber) {
          throw new BadRequestException('Vui lòng nhập số CCCD hoặc hộ chiếu của từng VĐV.');
        }
        const identity = item.existingAthlete ? undefined : await this.athleteIdentity.assertNew(transaction, item.identityInput);
        const currentSubmission = await ensureSubmission();
        const name = this.splitName(item.fullName);
        const createdAthlete = item.existingAthlete
          ? await transaction.athlete.findUniqueOrThrow({ where: { id: item.existingAthlete.id } })
          : await transaction.athlete.create({
          data: {
            ...name,
            fullName: item.fullName,
            gender: item.athlete.gender!,
            birthDate: item.birthDate,
            weight: item.weight,
            height: item.height,
            countryId: item.athlete.countryId!,
            federationId: item.athlete.federationId || null,
            phone: item.identityInput.phone,
            identity: { create: identity! },
            media: { create: media },
          },
        });
        const documentHash = this.athleteIdentity.normalize(item.identityInput).documentHash;
        if (documentHash && !createdAthlete.participantAccountId) {
          const owner = await transaction.participantAccount.findUnique({
            where: { documentHash },
            select: { id: true, displayName: true, birthDate: true, athlete: { select: { id: true } } },
          });
          const normalizeName = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
          if (owner && !owner.athlete && normalizeName(owner.displayName) === normalizeName(createdAthlete.fullName)
            && owner.birthDate?.toISOString().slice(0, 10) === createdAthlete.birthDate?.toISOString().slice(0, 10)) await transaction.athlete.update({
            where: { id: createdAthlete.id }, data: { participantAccountId: owner.id },
          });
        }
        const identityVerified = existingMedia ? registrationMediaState(existingMedia, item.identityInput.identityType).verified : autoVerifyIdentity;
        for (const category of newCategories) {
          const payment = this.registrationPayment(event);
          const canConfirmImmediately = identityVerified
            && payment.paymentStatus === PaymentStatus.NOT_REQUIRED;
          const registration = await transaction.eventRegistration.create({
            data: {
              eventId: event.id,
              athleteId: createdAthlete.id,
              accountId: submittingAccount?.id,
              submissionId: currentSubmission.id,
              categoryId: category.id,
              federationId: item.athlete.federationId || null,
              status: canConfirmImmediately ? RegistrationStatus.CONFIRMED : RegistrationStatus.SUBMITTED,
              ...payment,
              currency: event.registrationCurrency,
              ticketCode: this.ticketCode(),
            },
          });
          if (canConfirmImmediately) {
            await this.syncCompetitionEntry(transaction, {
              eventId: event.id,
              categoryId: category.id,
              athleteId: createdAthlete.id,
              countryId: item.athlete.countryId!,
              confirmed: true,
            });
          }
          registrations.push({
            existing: false,
            id: registration.id,
            athleteId: createdAthlete.id,
            athleteIndex: item.athleteIndex,
            categoryId: category.id,
            athleteName: createdAthlete.fullName,
            ticketCode: registration.ticketCode,
            status: registration.status,
            paymentStatus: registration.paymentStatus,
            feeAmount: registration.feeAmount,
            currency: registration.currency,
            paymentDueAt: registration.paymentStatus === PaymentStatus.PENDING
              ? this.paymentDueAt(registration.createdAt)
              : null,
          });
        }
      }

      if (consumedUploadIds.size) {
        const consumed = await transaction.participantMediaUpload.deleteMany({
          where: { id: { in: [...consumedUploadIds] }, expiresAt: { gt: new Date() } },
        });
        if (consumed.count !== consumedUploadIds.size) {
          throw new BadRequestException('Tệp tải lên đã hết hạn hoặc đã được sử dụng');
        }
      }

      const newRegistrations = registrations.filter((registration) => !registration.existing);
      const ticketEmailQueued = Boolean(submission) && newRegistrations.length > 0
        && newRegistrations.every((registration) => registration.status === RegistrationStatus.CONFIRMED);
      if (ticketEmailQueued) {
        await this.ticketEmailQueue.enqueueSubmission(transaction, contactEmail, referenceCode);
      }

      return {
        submissionId: submission?.id ?? null,
        referenceCode: submission ? referenceCode : null,
        type: submission?.type ?? submissionType,
        hasExistingRegistrations: registrations.some((registration) => registration.existing),
        status: registrations.every((registration) => registration.status === RegistrationStatus.CONFIRMED)
          ? RegistrationStatus.CONFIRMED
          : RegistrationStatus.SUBMITTED,
        registrations,
        ticketEmailQueued,
      };
    }, { maxWait: 10000, timeout: 30000 });
    const newlyStored: string[] = [];
    const result = await (async () => {
      try {
        // Upload direct multipart files before opening the DB transaction.
        for (const item of prepared) {
          for (const [type, file] of Object.entries(item.files) as Array<[string, RegistrationMediaFile | undefined]>) {
            if (!file) continue;
            if (!file.storageKey) {
              const stored = await this.storage.upload(file.buffer!, file.mimetype, type === 'avatar' ? 'athletes/avatars' : 'athletes/documents');
              file.storageKey = stored.key;
              file.size = stored.size;
              newlyStored.push(file.storageKey);
            }
          }
        }
        return await persistRegistration();
      } catch (error) {
        await Promise.all(newlyStored.map((key) => this.storage.deleteQuietly(key)));
        throw error;
      }
    })();
    await Promise.all([...replacedStorageKeys].map((key) => this.storage.deleteQuietly(key)));
    const newRegistrations = result.registrations.filter((registration) => !registration.existing);
    const notificationResults = await Promise.allSettled(newRegistrations.map((registration) => (
      this.notifications.notifyRegistration(
        this.prisma,
        registration.id,
        'REGISTRATION_CREATED',
        'Có hồ sơ đăng ký mới',
        registration.status === RegistrationStatus.CONFIRMED ? 'Đã xác nhận tham dự' : 'Đang chờ duyệt',
      )
    )));
    notificationResults.forEach((notificationResult, index) => {
      if (notificationResult.status === 'rejected') {
        this.logger.error(
          `Không thể tạo thông báo cho hồ sơ ${newRegistrations[index].id}`,
          notificationResult.reason instanceof Error
            ? notificationResult.reason.stack
            : String(notificationResult.reason),
        );
      }
    });
    return { ...result, ticketEmailSent: false };
  }

  private registrationPayment(event: { paymentMode: PaymentMode; registrationFee: number }) {
    const free = event.paymentMode === PaymentMode.FREE;
    return {
      feeAmount: free ? 0 : event.registrationFee,
      paymentStatus: free ? PaymentStatus.NOT_REQUIRED : PaymentStatus.PENDING,
    };
  }

  async createRegistration(accountId: string, dto: CreatePublicRegistrationDto) {
    let profile = await this.getAthleteProfile(accountId);
    if (!profile.accountTypes.includes(SportDataAccountType.ATHLETE)) throw new ForbiddenException('Tài khoản chưa có loại VĐV.');
    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
      include: {
        categories: { where: { id: dto.categoryId }, include: { sport: true } },
        participatingFederations: { select: { id: true } },
      },
    });
    if (!event?.isPublished) throw new NotFoundException('Sự kiện không tồn tại hoặc chưa công khai');
    const category = event.categories[0];
    if (!category) throw new BadRequestException('Hạng đấu không thuộc sự kiện này');
    this.validateRegistrationWindow(event);
    this.validateAthleteForCategory(profile.athlete, { ...category, ...resolveEventAgeLimits(event, category) }, event.startDate);

    const allowedFederations = event.participatingFederations.map((item) => item.id);
    if (profile.athlete.federationId) {
      if (allowedFederations.length && !allowedFederations.includes(profile.athlete.federationId)) {
        throw new BadRequestException('Đơn vị của vận động viên không thuộc danh sách được tham gia');
      }
    } else if (!event.allowIndependentAthletes) {
      throw new BadRequestException('Sự kiện này không nhận vận động viên tự do');
    }

    const settings = await this.systemSettings.get();
    if (!settings.values.identityOcrEnabled) {
      await this.autoVerifyIdentityMedia(profile.athlete.id);
      profile = await this.getProfile(accountId);
    }
    let canConfirmImmediately = false;
    try {
      const registration = await this.prisma.$transaction(async (transaction) => {
        await this.athleteIdentity.lock(transaction);
        const media = await transaction.athleteMedia.findMany({ where: { athleteId: profile.athlete.id }, select: registrationMediaSelect });
        const identity = registrationMediaState(media, profile.identityType);
        this.assertRequiredRegistrationMedia(identity);
        const existing = await transaction.eventRegistration.findMany({
          where: { eventId: event.id, athleteId: profile.athlete.id }, include: { category: true },
        });
        const conflicting = existing.find((registration) => registrationDisciplineKey(registration.category) === registrationDisciplineKey(category));
        if (conflicting) throw new ConflictException(`Bạn đã đăng ký nội dung này với thẻ ${conflicting.ticketCode}`);
        const payment = this.registrationPayment(event);
        canConfirmImmediately = identity.verified && payment.paymentStatus === PaymentStatus.NOT_REQUIRED;
        const registration = await transaction.eventRegistration.create({
          data: {
            eventId: event.id,
            athleteId: profile.athlete.id,
            accountId,
            categoryId: category.id,
            federationId: profile.athlete.federationId,
            status: canConfirmImmediately ? RegistrationStatus.CONFIRMED : RegistrationStatus.SUBMITTED,
            ...payment,
            currency: event.registrationCurrency,
            ticketCode: this.ticketCode(),
          },
        });
        if (canConfirmImmediately) {
          await this.syncCompetitionEntry(transaction, {
            eventId: event.id,
            categoryId: category.id,
            athleteId: profile.athlete.id,
            countryId: profile.athlete.countryId,
            confirmed: true,
          });
          await this.ticketEmailQueue.enqueueTicket(transaction, profile.email, registration.ticketCode);
        }
        return transaction.eventRegistration.findUniqueOrThrow({
          where: { id: registration.id },
          include: this.registrationInclude(),
        });
      });
      await this.notifications.notifyRegistration(
        this.prisma,
        registration.id,
        'REGISTRATION_CREATED',
        'Có hồ sơ đăng ký mới',
        registration.status === RegistrationStatus.CONFIRMED ? 'Đã xác nhận tham dự' : 'Đang chờ duyệt',
      );
      return {
        ...registration,
        ticketEmailSent: false,
        ticketEmailQueued: canConfirmImmediately,
      };
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Bạn đã đăng ký hạng đấu này');
      throw error;
    }
  }

  async listRegistrations(accountId: string) {
    return this.prisma.eventRegistration.findMany({
      where: { OR: [{ accountId }, { athlete: { participantAccountId: accountId } }] },
      include: this.registrationInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOwnRegistrationState(accountId: string, eventId?: string) {
    if (!eventId?.trim()) throw new BadRequestException('Thiếu sự kiện cần kiểm tra');
    const account = await this.prisma.participantAccount.findUnique({
      where: { id: accountId },
      select: { athlete: { select: { id: true } } },
    });
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản');
    if (!account.athlete) return { registered: false, registration: null };

    let registration = await this.prisma.eventRegistration.findFirst({
      where: { eventId: eventId.trim(), athleteId: account.athlete.id },
      select: {
        id: true,
        ticketCode: true,
        status: true,
        paymentStatus: true,
        feeAmount: true,
        currency: true,
        createdAt: true,
        event: { select: { paymentMode: true, registrationFee: true, registrationCurrency: true } },
        category: { select: { id: true, name: true, sport: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      registration
      && registration.paymentStatus === PaymentStatus.PENDING
      && registration.feeAmount === 0
      && registration.event.paymentMode !== PaymentMode.FREE
      && registration.event.registrationFee > 0
    ) {
      registration = await this.prisma.eventRegistration.update({
        where: { id: registration.id },
        data: {
          feeAmount: registration.event.registrationFee,
          currency: registration.event.registrationCurrency,
        },
        select: {
          id: true,
          ticketCode: true,
          status: true,
          paymentStatus: true,
          feeAmount: true,
          currency: true,
          createdAt: true,
          event: { select: { paymentMode: true, registrationFee: true, registrationCurrency: true } },
          category: { select: { id: true, name: true, sport: { select: { id: true, name: true } } } },
        },
      });
    }

    return { registered: Boolean(registration), registration };
  }

  async getTicket(ticketCode: string, includeAssets = false) {
    let registration = await this.prisma.eventRegistration.findUnique({
      where: { ticketCode: ticketCode.trim().toUpperCase() },
      include: {
        event: { include: { sport: true } },
        category: { include: { sport: true } },
        federation: true,
        athlete: {
          include: {
            country: true,
            federation: true,
            statistics: true,
            media: {
              where: { type: AthleteMediaType.AVATAR },
              select: { storageKey: true, mimeType: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!registration) throw new TicketNotFoundException('Không tìm thấy thẻ tham dự');
    if (registration.status === RegistrationStatus.SUBMITTED && registration.paymentStatus === PaymentStatus.PAID) {
      const finalized = await this.finalizePaidRegistration(registration.id);
      if (finalized) registration = { ...registration, status: RegistrationStatus.CONFIRMED,
        statusChangedAt: finalized.statusChangedAt, statusChangedBy: 'SYSTEM:PAYMENT_CONFIRMED' };
    }
    if (
      registration.paymentStatus === PaymentStatus.PENDING
      && registration.feeAmount === 0
      && registration.event.paymentMode !== PaymentMode.FREE
      && registration.event.registrationFee > 0
    ) {
      await this.prisma.eventRegistration.update({
        where: { id: registration.id },
        data: {
          feeAmount: registration.event.registrationFee,
          currency: registration.event.registrationCurrency,
        },
      });
      registration = {
        ...registration,
        feeAmount: registration.event.registrationFee,
        currency: registration.event.registrationCurrency,
      };
    }

    // Registration/payment records stay separate; an issued pass belongs to the
    // athlete at this event, including disciplines added in later submissions.
    const isIssued = registration.status === RegistrationStatus.CONFIRMED
      && (registration.paymentStatus === PaymentStatus.PAID
        || registration.paymentStatus === PaymentStatus.NOT_REQUIRED);
    const issuedRegistrations = isIssued ? await this.prisma.eventRegistration.findMany({
      where: {
        eventId: registration.eventId,
        athleteId: registration.athleteId,
        status: RegistrationStatus.CONFIRMED,
        paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.NOT_REQUIRED] },
      },
      include: { category: { include: { sport: true } }, federation: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }) : [];
    if (issuedRegistrations.length) {
      registration = { ...registration, ...issuedRegistrations[0] };
    }
    const ticketRegistrations = issuedRegistrations.length ? issuedRegistrations : [registration];
    const categories = ticketRegistrations.map(({ category }) => ({
      id: category.id,
      name: category.name,
      gender: category.gender,
      discipline: category.discipline,
      uniform: category.uniform,
      beltLevel: category.beltLevel,
      minAge: category.minAge,
      maxAge: category.maxAge,
      minWeight: category.minWeight,
      maxWeight: category.maxWeight,
      sport: { id: category.sport.id, code: category.sport.code, name: category.sport.name },
    }));
    const sportIds = new Set(ticketRegistrations.map((item) => item.category.sportId));
    const sportStatistics = registration.athlete.statistics.filter((item) => sportIds.has(item.sportId));
    const eventStatistics = sportStatistics.filter((item) => item.eventId === registration.eventId);
    const careerStatistics = [...sportIds].flatMap((sportId) => {
      const statistics = sportStatistics.filter((item) => item.sportId === sportId);
      const overall = statistics.filter((item) => item.eventId === null);
      return overall.length ? overall : statistics;
    });

    return {
      ticketCode: registration.ticketCode,
      status: registration.status,
      paymentStatus: registration.paymentStatus,
      feeAmount: registration.feeAmount,
      currency: registration.currency,
      paymentDueAt: registration.paymentStatus === PaymentStatus.PENDING
        ? this.paymentDueAt(registration.createdAt)
        : null,
      isValid: registration.status === RegistrationStatus.CONFIRMED
        && (registration.paymentStatus === PaymentStatus.PAID
          || registration.paymentStatus === PaymentStatus.NOT_REQUIRED),
      issuedAt: registration.status === RegistrationStatus.CONFIRMED
        ? registration.statusChangedAt || registration.createdAt
        : undefined,
      event: {
        id: registration.event.id,
        name: registration.event.name,
        startDate: registration.event.startDate,
        endDate: registration.event.endDate,
        location: registration.event.location,
        logoUrl: registration.event.logoUrl,
        ticketDesign: registration.event.ticketDesign,
        ticketThemePreset: registration.event.ticketThemePreset,
        ticketLayout: registration.event.ticketLayout,
        ticketPrimaryColor: registration.event.ticketPrimaryColor,
        ticketSecondaryColor: registration.event.ticketSecondaryColor,
        ticketAccentColor: registration.event.ticketAccentColor,
        paymentMode: registration.event.paymentMode,
        paymentProviders: registration.event.paymentProviders.length
          ? registration.event.paymentProviders
          : registration.event.paymentMode === PaymentMode.MANUAL
            ? ['BANK_QR']
            : [],
        ticketBackgroundUrl: registration.event.ticketBackgroundSize
          ? `/api/events/${registration.event.id}/ticket-background?v=${new Date(registration.event.updatedAt).getTime()}`
          : null,
      },
      sport: {
        id: registration.category.sport.id,
        code: registration.category.sport.code,
        name: registration.category.sport.name,
      },
      category: categories[0],
      categories,
      athlete: {
        id: registration.athlete.id,
        fullName: registration.athlete.fullName,
        birthDate: registration.athlete.birthDate,
        gender: registration.athlete.gender,
        weight: registration.athlete.weight,
        country: registration.athlete.country,
        federation: registration.federation || registration.athlete.federation,
        avatarUrl: `/api/participant-auth/avatar/${registration.athlete.id}`,
      },
      achievements: {
        event: this.aggregateStatistics(eventStatistics),
        career: this.aggregateStatistics(careerStatistics),
      },
      ...(includeAssets ? {
        assets: {
          backgroundData: registration.event.ticketBackgroundStorageKey
            ? await this.storage.read(registration.event.ticketBackgroundStorageKey)
            : null,
          backgroundMimeType: registration.event.ticketBackgroundMimeType,
          avatarData: registration.athlete.media[0]?.storageKey
            ? await this.storage.read(registration.athlete.media[0].storageKey)
            : null,
          avatarMimeType: registration.athlete.media[0]?.mimeType || null,
        },
      } : {}),
    };
  }

  async getIssuedTicket(ticketCode: string, includeAssets = false) {
    const ticket = await this.getTicket(ticketCode, includeAssets);
    if (!ticket.isValid) {
      throw new TicketNotIssuedException(
        'Thẻ chỉ được phát hành sau khi hồ sơ được duyệt và thanh toán đã hoàn tất',
      );
    }
    return ticket;
  }

  async getSubmissionTickets(referenceCode: string, contactEmail: string, includeAssets = false) {
    const submission = await this.prisma.registrationSubmission.findUnique({
      where: { referenceCode: referenceCode.trim().toUpperCase() },
      include: {
        registrations: {
          select: { ticketCode: true, status: true, paymentStatus: true, athleteId: true, eventId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!submission || submission.contactEmail.toLowerCase() !== contactEmail.trim().toLowerCase()) {
      throw new TicketNotFoundException('Không tìm thấy bộ thẻ với mã hồ sơ và email này');
    }
    const hasUnissuedTicket = submission.registrations.some((item) => (
      item.status !== RegistrationStatus.CONFIRMED
      || (item.paymentStatus !== PaymentStatus.PAID && item.paymentStatus !== PaymentStatus.NOT_REQUIRED)
    ));
    if (hasUnissuedTicket) {
      throw new TicketNotIssuedException(
        'Bộ thẻ chỉ được phát hành sau khi tất cả hồ sơ được duyệt và thanh toán đã hoàn tất',
      );
    }
    const registrationsByAthlete = new Map<string, typeof submission.registrations[number]>();
    for (const item of submission.registrations) {
      const key = `${item.eventId}:${item.athleteId}`;
      if (!registrationsByAthlete.has(key)) registrationsByAthlete.set(key, item);
    }
    const tickets = await Promise.all(
      [...registrationsByAthlete.values()].map((item) => this.getIssuedTicket(item.ticketCode, includeAssets)),
    );
    return {
      meta: {
        referenceCode: submission.referenceCode,
        organizationName: submission.organizationName,
        contactName: submission.contactName,
      },
      tickets,
    };
  }

  async listAllRegistrations(eventId?: string) {
    const paidEvents = await this.prisma.event.findMany({
      where: {
        ...(eventId ? { id: eventId } : {}),
        paymentMode: { not: PaymentMode.FREE },
        registrationFee: { gt: 0 },
      },
      select: { id: true, registrationFee: true, registrationCurrency: true },
    });
    await Promise.all(paidEvents.map((event) => this.prisma.eventRegistration.updateMany({
      where: { eventId: event.id, paymentStatus: PaymentStatus.PENDING, feeAmount: 0 },
      data: { feeAmount: event.registrationFee, currency: event.registrationCurrency },
    })));
    const settings = await this.systemSettings.get();
    if (!settings.values.identityOcrEnabled) {
      await this.prisma.athleteMedia.updateMany({
        where: {
          type: { in: [AthleteMediaType.CCCD_FRONT, AthleteMediaType.CCCD_BACK, AthleteMediaType.PASSPORT] },
          verificationStatus: DocumentVerificationStatus.PENDING,
          ...(eventId ? { athlete: { publicRegistrations: { some: { eventId } } } } : {}),
        },
        data: {
          verificationStatus: DocumentVerificationStatus.VERIFIED,
          verificationNote: 'Tự động duyệt vì OCR CCCD / Hộ chiếu đang tắt.',
          verifiedAt: new Date(),
          verifiedBy: 'SYSTEM:OCR_DISABLED',
        },
      });
    }
    const registrations = await this.prisma.eventRegistration.findMany({
      where: eventId ? { eventId } : undefined,
      include: {
        ...this.registrationInclude(),
        account: { select: { displayName: true, email: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const entries = registrations.length
      ? await this.prisma.competitionEntry.findMany({
          where: {
            athleteId: { in: registrations.map((item) => item.athleteId) },
            eventId: { in: registrations.map((item) => item.eventId) },
            categoryId: { in: registrations.map((item) => item.categoryId) },
          },
          select: { id: true, eventId: true, categoryId: true, athleteId: true, seed: true, status: true },
        })
      : [];
    const entriesByRegistration = new Map(entries.map((entry) => [
      `${entry.eventId}:${entry.categoryId}:${entry.athleteId}`,
      entry,
    ]));
    return registrations.map((registration) => ({
      ...registration,
      competitionEntry: entriesByRegistration.get(
        `${registration.eventId}:${registration.categoryId}:${registration.athleteId}`,
      ) || null,
    }));
  }

  async checkAdminRegistrationEligibility(dto: AdminCreateRegistrationDto) {
    const context = await this.adminRegistrationContext(dto);
    return {
      eligible: context.reasons.length === 0,
      reasons: context.reasons,
      warnings: context.warnings,
      athlete: {
        id: context.athleteId,
        fullName: context.athlete.fullName,
        gender: context.athlete.gender,
        birthDate: context.athlete.birthDate,
        weight: context.athlete.weight,
      },
      category: {
        id: context.category.id,
        name: context.category.name,
      },
      payment: {
        mode: context.event.paymentMode,
        feeAmount: context.event.paymentMode === PaymentMode.FREE ? 0 : context.event.registrationFee,
        currency: context.event.registrationCurrency,
        providers: context.event.paymentProviders,
      },
    };
  }

  async createAdminRegistration(dto: AdminCreateRegistrationDto, changedBy?: string) {
    const context = await this.adminRegistrationContext(dto);
    if (context.reasons.length) {
      throw new BadRequestException(context.reasons.join('. '));
    }

    const replacedStorageKeys = new Set<string>();
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        await this.athleteIdentity.lock(transaction);
        const uploads = await this.resolveAdminMediaUploads(dto, transaction);
        const media = uploads.map((upload) => ({
          type: upload.type, storageKey: upload.storageKey, mimeType: upload.mimeType, size: upload.size,
          verificationStatus: upload.type === AthleteMediaType.AVATAR ? null : DocumentVerificationStatus.VERIFIED,
          verifiedAt: upload.type === AthleteMediaType.AVATAR ? null : new Date(),
          verifiedBy: upload.type === AthleteMediaType.AVATAR ? null : changedBy || 'CMS',
          verificationNote: upload.type === AthleteMediaType.AVATAR ? null : 'Quản trị viên kiểm tra khi tạo hồ sơ tham gia.',
        }));
        if (!context.athleteId) {
          await this.athleteIdentity.assertNew(transaction, {
            ...dto.athlete!, birthDate: new Date(dto.athlete!.birthDate),
          });
        }
        const athlete = context.athleteId
          ? await transaction.athlete.findUniqueOrThrow({
              where: { id: context.athleteId },
              include: { media: { select: registrationMediaSelect } },
            })
          : await transaction.athlete.create({
              data: {
                firstName: dto.athlete!.firstName.trim(),
                lastName: dto.athlete!.lastName.trim(),
                fullName: dto.athlete!.fullName.trim(),
                identity: { create: this.athleteIdentity.normalize({ ...dto.athlete!, birthDate: new Date(dto.athlete!.birthDate) }) },
                email: dto.athlete!.email.trim().toLowerCase(),
                phone: dto.athlete!.phone.trim(),
                gender: dto.athlete!.gender,
                birthDate: new Date(dto.athlete!.birthDate),
                weight: dto.athlete!.weight,
                height: dto.athlete!.height,
                countryId: dto.athlete!.countryId,
                federationId: dto.athlete!.federationId || null,
                media: { create: media },
              },
              include: { media: { select: registrationMediaSelect } },
            });
        if (context.athleteId) {
          for (const document of media) {
            const previousKey = athlete.media.find((item) => item.type === document.type)?.storageKey;
            await transaction.athleteMedia.upsert({
              where: { athleteId_type: { athleteId: athlete.id, type: document.type } },
              create: { ...document, athleteId: athlete.id }, update: document,
            });
            if (previousKey && previousKey !== document.storageKey) replacedStorageKeys.add(previousKey);
          }
        }
        const finalMedia = context.athleteId
          ? await transaction.athleteMedia.findMany({ where: { athleteId: athlete.id }, select: registrationMediaSelect })
          : athlete.media;
        this.assertRequiredRegistrationMedia(registrationMediaState(finalMedia, dto.athlete?.identityType));
        if (uploads.length) {
          const consumed = await transaction.participantMediaUpload.deleteMany({
            where: { id: { in: uploads.map((upload) => upload.id) }, expiresAt: { gt: new Date() } },
          });
          if (consumed.count !== uploads.length) throw new BadRequestException('Tệp đã được sử dụng hoặc hết hạn. Vui lòng tải lại.');
        }
        const existing = await transaction.eventRegistration.findMany({
          where: { eventId: context.event.id, athleteId: athlete.id }, include: { category: true },
        });
        if (existing.some((registration) => registrationDisciplineKey(registration.category) === registrationDisciplineKey(context.category))) {
          throw new ConflictException('Vận động viên đã đăng ký một hạng đấu trong nội dung này');
        }
        const payment = this.registrationPayment(context.event);
        const paymentStatus = payment.paymentStatus === PaymentStatus.NOT_REQUIRED
          ? payment.paymentStatus
          : dto.paymentStatus === PaymentStatus.PAID ? PaymentStatus.PAID : PaymentStatus.PENDING;
        const paymentNote = paymentStatus === PaymentStatus.PAID
          ? dto.paymentNote?.trim() || 'CMS ghi nhận đã thu lệ phí thủ công'
          : null;
        const registration = await transaction.eventRegistration.create({
          data: {
            eventId: context.event.id,
            athleteId: athlete.id,
            categoryId: context.category.id,
            federationId: athlete.federationId,
            status: RegistrationStatus.CONFIRMED,
            statusReason: 'Quản trị viên tạo và xác nhận hồ sơ trực tiếp trên CMS',
            statusChangedAt: new Date(),
            statusChangedBy: changedBy || 'CMS',
            paymentStatus,
            paymentStatusReason: paymentNote,
            paymentStatusChangedAt: paymentStatus === PaymentStatus.PAID ? new Date() : null,
            paymentStatusChangedBy: paymentStatus === PaymentStatus.PAID ? changedBy || 'CMS' : null,
            feeAmount: payment.feeAmount,
            currency: context.event.registrationCurrency,
            ticketCode: this.ticketCode(),
          },
        });
        if (paymentStatus === PaymentStatus.PAID) {
          await transaction.paymentStatusHistory.create({
            data: {
              registrationId: registration.id,
              fromStatus: PaymentStatus.PENDING,
              toStatus: PaymentStatus.PAID,
              reason: paymentNote!,
              changedBy: changedBy || 'CMS',
            },
          });
        }
        await this.syncCompetitionEntry(transaction, {
          eventId: context.event.id,
          categoryId: context.category.id,
          athleteId: athlete.id,
          countryId: athlete.countryId,
          confirmed: true,
        });
        return transaction.eventRegistration.findUniqueOrThrow({
          where: { id: registration.id },
          include: this.registrationInclude(),
        });
      });
      await Promise.all([...replacedStorageKeys].map((key) => this.storage.deleteQuietly(key)));
      await this.notifications.notifyRegistration(
        this.prisma,
        created.id,
        'REGISTRATION_CREATED',
        'CMS vừa thêm một hồ sơ đăng ký',
        'Quản trị viên đã xác nhận tham dự',
      );
      return created;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Vận động viên đã đăng ký hạng đấu này');
      }
      throw error;
    }
  }

  private async adminRegistrationContext(dto: AdminCreateRegistrationDto) {
    if (Boolean(dto.athleteId) === Boolean(dto.athlete)) {
      throw new BadRequestException('Chỉ chọn một VĐV có sẵn hoặc nhập một VĐV mới');
    }
    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
      include: {
        categories: { where: { id: dto.categoryId }, include: { sport: true } },
        participatingFederations: { select: { id: true } },
      },
    });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');
    const category = event.categories[0];
    if (!category) throw new BadRequestException('Hạng đấu không thuộc sự kiện này');

    const existingAthlete = dto.athleteId
      ? await this.prisma.athlete.findUnique({
          where: { id: dto.athleteId },
          include: { media: { select: registrationMediaSelect } },
        })
      : null;
    if (dto.athleteId && !existingAthlete) throw new NotFoundException('Không tìm thấy vận động viên');
    const draftAthlete = dto.athlete
      ? {
          ...dto.athlete,
          birthDate: new Date(dto.athlete.birthDate),
          federationId: dto.athlete.federationId || null,
          media: [],
        }
      : null;
    if (draftAthlete && Number.isNaN(draftAthlete.birthDate.getTime())) {
      throw new BadRequestException('Ngày sinh vận động viên không hợp lệ');
    }
    const athlete = existingAthlete || draftAthlete!;
    const reasons: string[] = [];
    const warnings: string[] = [];

    const country = await this.prisma.country.findUnique({ where: { id: athlete.countryId }, select: { id: true } });
    if (!country) reasons.push('Quốc gia của vận động viên không hợp lệ');
    if (athlete.federationId) {
      const federation = await this.prisma.federation.findUnique({
        where: { id: athlete.federationId },
        select: { id: true, countryId: true },
      });
      if (!federation || federation.countryId !== athlete.countryId) {
        reasons.push('Đơn vị chủ quản và quốc gia không phù hợp');
      } else if (event.participatingFederations.length
        && !event.participatingFederations.some((item) => item.id === federation.id)) {
        reasons.push('Đơn vị chủ quản không thuộc danh sách tham gia sự kiện');
      }
    } else if (!event.allowIndependentAthletes) {
      reasons.push('Sự kiện không nhận vận động viên tự do');
    }

    try {
      this.validateAthleteForCategory(
        athlete,
        { ...category, ...resolveEventAgeLimits(event, category) },
        event.startDate,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        const response = error.getResponse();
        reasons.push(typeof response === 'string' ? response : String((response as { message?: string }).message || error.message));
      } else {
        throw error;
      }
    }

    if (existingAthlete) {
      const existing = await this.prisma.eventRegistration.findMany({
        where: { eventId: event.id, athleteId: existingAthlete.id }, include: { category: true },
      });
      if (existing.some((registration) => registrationDisciplineKey(registration.category) === registrationDisciplineKey(category))) {
        reasons.push('Vận động viên đã đăng ký một hạng đấu trong nội dung này');
      }
      if (!registrationMediaState(existingAthlete.media).verified) {
        warnings.push('Giấy tờ chưa được xác thực; có thể xác thực trong hồ sơ VĐV');
      }
    }

    const uploads = await this.resolveAdminMediaUploads(dto);
    const combinedMedia = new Map((existingAthlete?.media || []).map((media) => [media.type, media]));
    for (const upload of uploads) combinedMedia.set(upload.type, {
      type: upload.type, storageKey: upload.storageKey, mimeType: upload.mimeType, size: upload.size, verificationStatus: null,
    });
    const mediaState = registrationMediaState([...combinedMedia.values()], dto.athlete?.identityType);
    if (!mediaState.hasAvatar) reasons.push('Hồ sơ phải có ảnh đại diện trước khi đăng ký');
    if (!mediaState.hasIdentityDocuments) reasons.push('Hồ sơ phải có đủ CCCD hai mặt hoặc hộ chiếu trước khi đăng ký');
    if (dto.athlete && !this.athleteIdentity.normalize({ ...dto.athlete, birthDate: new Date(dto.athlete.birthDate) }).documentHash) {
      reasons.push('Vui lòng nhập số CCCD hoặc hộ chiếu của VĐV');
    }

    if (category.maxEntriesPerCountry) {
      const currentEntries = await this.prisma.eventRegistration.count({
        where: {
          eventId: event.id,
          categoryId: category.id,
          athlete: { countryId: athlete.countryId },
          status: { in: [RegistrationStatus.SUBMITTED, RegistrationStatus.CONFIRMED] },
        },
      });
      if (currentEntries >= category.maxEntriesPerCountry) {
        reasons.push(`Quốc gia đã đạt giới hạn ${category.maxEntriesPerCountry} VĐV cho hạng đấu này`);
      }
    }

    return { event, category, athlete, athleteId: existingAthlete?.id, reasons: [...new Set(reasons)], warnings };
  }

  private async resolveAdminMediaUploads(dto: AdminCreateRegistrationDto, database: Prisma.TransactionClient = this.prisma) {
    const types = { avatar: AthleteMediaType.AVATAR, cccdFront: AthleteMediaType.CCCD_FRONT,
      cccdBack: AthleteMediaType.CCCD_BACK, passport: AthleteMediaType.PASSPORT } as const;
    const references = Object.entries(types).flatMap(([key, type]) => {
      const reference = dto.mediaUploads?.[key as keyof typeof types];
      return reference ? [{ ...reference, type }] : [];
    });
    if (!references.length) return [];
    if (references.some((reference) => !reference.id || !reference.token)
      || new Set(references.map((reference) => reference.id)).size !== references.length) {
      throw new BadRequestException('Tệp tải lên không hợp lệ hoặc được sử dụng nhiều lần');
    }
    const uploads = await database.participantMediaUpload.findMany({ where: {
      id: { in: references.map((reference) => reference.id) }, expiresAt: { gt: new Date() },
    } });
    return references.map((reference) => {
      const upload = uploads.find((item) => item.id === reference.id);
      if (!upload?.storageKey || upload.type !== reference.type || upload.tokenHash !== this.hashResetToken(reference.token)) {
        throw new BadRequestException('Tệp tải lên đã hết hạn hoặc không hợp lệ. Vui lòng tải lại tệp.');
      }
      this.validateFile(upload.type, { storageKey: upload.storageKey, mimetype: upload.mimeType, size: upload.size });
      return upload;
    });
  }

  async deleteRegistration(id: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.eventRegistration.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Không tìm thấy lượt đăng ký');
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.eventId}))`;
        await transaction.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${current.eventId} FOR UPDATE`;
        await transaction.$queryRaw`SELECT "id" FROM "Athlete" WHERE "id" = ${current.athleteId} FOR UPDATE`;
        const registration = await transaction.eventRegistration.findUnique({ where: { id } });
        if (!registration) throw new NotFoundException('Không tìm thấy lượt đăng ký');

        const competitionWhere = { eventId: registration.eventId, categoryId: registration.categoryId };
        const counts = await Promise.all([
          transaction.draw.count({ where: competitionWhere }),
          transaction.match.count({ where: competitionWhere }),
          transaction.heat.count({ where: competitionWhere }),
          transaction.roundRobinGroup.count({ where: competitionWhere }),
        ]);
        if (counts.some(Boolean)) {
          throw new ConflictException('Hạng đấu đã có nhánh đấu hoặc lịch thi đấu. Hãy thu hồi nhánh đấu/lịch thi đấu trước khi xóa đăng ký.');
        }

        const entryWhere = { ...competitionWhere, athleteId: registration.athleteId };
        const entries = await transaction.competitionEntry.findMany({ where: entryWhere, select: { id: true } });
        const entryIds = new Set(entries.map((entry) => entry.id));
        const configurations = await transaction.drawPreconfiguration.findMany({ where: competitionWhere });
        for (const configuration of configurations) {
          const pairs = configuration.pairs as Array<{ entry1Id: string; entry2Id: string }>;
          await transaction.drawPreconfiguration.update({
            where: { id: configuration.id },
            data: {
              pairs: pairs.filter((pair) => !entryIds.has(pair.entry1Id) && !entryIds.has(pair.entry2Id)),
              revision: { increment: 1 },
              inputVersion: null,
              slots: Prisma.DbNull,
              plan: Prisma.DbNull,
              previewedAt: null,
            },
          });
        }
        await transaction.competitionEntry.deleteMany({ where: entryWhere });
        await transaction.ticketEmailJob.deleteMany({ where: { ticketCode: registration.ticketCode } });
        await transaction.eventRegistration.delete({ where: { id } });
        return { id, success: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } catch (error: any) {
      if (error?.code === 'P2034'
        || (error?.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))) {
        throw new ConflictException('Dữ liệu vừa thay đổi. Hãy tải lại và thử xóa đăng ký lần nữa.');
      }
      throw error;
    }
  }

  async updateRegistrationCategory(id: string, categoryId: string, changedBy?: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.eventRegistration.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Không tìm thấy lượt đăng ký');
        // Share the draw lock so a category cannot move while a bracket is generated.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.eventId}))`;
        await transaction.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${current.eventId} FOR UPDATE`;
        await transaction.$queryRaw`SELECT "id" FROM "Athlete" WHERE "id" = ${current.athleteId} FOR UPDATE`;
        const registration = await transaction.eventRegistration.findUniqueOrThrow({
          where: { id }, include: { athlete: true, category: true, event: true },
        });
        if (registration.categoryId === categoryId) {
          return transaction.eventRegistration.findUniqueOrThrow({ where: { id }, include: this.registrationInclude() });
        }
        const category = await transaction.category.findFirst({
          where: { id: categoryId, events: { some: { id: registration.eventId } } },
        });
        if (!category) throw new BadRequestException('Hạng đấu không thuộc sự kiện này');
        if (category.sportId !== registration.category.sportId) {
          throw new BadRequestException('Chỉ có thể đổi nội dung và hạng cân trong cùng môn thể thao');
        }
        this.validateAthleteForCategory(registration.athlete,
          { ...category, ...resolveEventAgeLimits(registration.event, category) }, registration.event.startDate);
        const otherRegistrations = await transaction.eventRegistration.findMany({
          where: { eventId: registration.eventId, athleteId: registration.athleteId, id: { not: id } },
          include: { category: true },
        });
        if (otherRegistrations.some((item) => registrationDisciplineKey(item.category) === registrationDisciplineKey(category))) {
          throw new ConflictException('Vận động viên đã đăng ký một hạng đấu trong nội dung này');
        }
        const competitionWhere = { eventId: registration.eventId, categoryId: { in: [registration.categoryId, categoryId] } };
        const [draws, matches, heats, groups] = await Promise.all([
          transaction.draw.count({ where: competitionWhere }),
          transaction.match.count({ where: competitionWhere }),
          transaction.heat.count({ where: competitionWhere }),
          transaction.roundRobinGroup.count({ where: competitionWhere }),
        ]);
        if (draws || matches || heats || groups) {
          throw new ConflictException('Hạng đấu đã có bốc thăm hoặc lịch thi đấu. Hãy hoàn tác bốc thăm/lịch thi đấu trước khi đổi hạng đấu');
        }
        const targetEntry = await transaction.competitionEntry.findUnique({
          where: { eventId_categoryId_athleteId: { eventId: registration.eventId, categoryId, athleteId: registration.athleteId } },
        });
        if (targetEntry) throw new ConflictException('Vận động viên đã có suất thi đấu ở hạng đấu mới');
        if (category.maxEntriesPerCountry && (registration.status === RegistrationStatus.SUBMITTED || registration.status === RegistrationStatus.CONFIRMED)) {
          const [registrations, entries] = await Promise.all([
            transaction.eventRegistration.findMany({ where: {
              eventId: registration.eventId, categoryId, athlete: { countryId: registration.athlete.countryId },
              status: { in: [RegistrationStatus.SUBMITTED, RegistrationStatus.CONFIRMED] },
            }, select: { athleteId: true } }),
            transaction.competitionEntry.findMany({ where: {
              eventId: registration.eventId, categoryId, countryId: registration.athlete.countryId,
              status: { in: [EntryStatus.REGISTERED, EntryStatus.VERIFIED] },
            }, select: { id: true, athleteId: true } }),
          ]);
          const occupiedPlaces = new Set([
            ...registrations.map((item) => `athlete:${item.athleteId}`),
            ...entries.map((item) => item.athleteId ? `athlete:${item.athleteId}` : `entry:${item.id}`),
          ]);
          if (occupiedPlaces.size >= category.maxEntriesPerCountry) {
            throw new BadRequestException(`Quốc gia đã đạt giới hạn ${category.maxEntriesPerCountry} VĐV cho hạng đấu này`);
          }
        }
        await transaction.competitionEntry.updateMany({
          where: { eventId: registration.eventId, categoryId: registration.categoryId, athleteId: registration.athleteId },
          data: { categoryId, seed: null },
        });
        await transaction.eventRegistration.update({ where: { id }, data: { categoryId } });
        if (registration.status === RegistrationStatus.CONFIRMED) {
          await this.syncCompetitionEntry(transaction, { eventId: registration.eventId, categoryId,
            athleteId: registration.athleteId, countryId: registration.athlete.countryId, confirmed: true });
        }
        await this.notifications.notifyRegistration(transaction, id, 'REGISTRATION_CATEGORY_CHANGED',
          'CMS đã cập nhật nội dung / hạng cân',
          `${registration.category.name} → ${category.name} · ${changedBy || 'CMS'}`);
        return transaction.eventRegistration.findUniqueOrThrow({ where: { id }, include: this.registrationInclude() });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } catch (error: any) {
      if (['P2002', 'P2034'].includes(error?.code)
        || (error?.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))) {
        throw new ConflictException('Dữ liệu vừa thay đổi hoặc hạng đấu đã được đăng ký. Hãy tải lại và thử lại');
      }
      throw error;
    }
  }

  async updateRegistrationStatus(id: string, status: RegistrationStatus, reason: string, changedBy?: string) {
    const registration = await this.prisma.eventRegistration.findUnique({
      where: { id },
      include: {
        account: { select: { email: true } },
        submission: { select: { contactEmail: true } },
      },
    });
    if (!registration) throw new NotFoundException('Không tìm thấy lượt đăng ký');
    if (registration.status === status) throw new BadRequestException('Hồ sơ đang ở trạng thái này');
    const normalizedReason = reason.trim();
    const athlete = await this.prisma.athlete.findUnique({
      where: { id: registration.athleteId },
      select: {
        countryId: true,
        media: {
          select: registrationMediaSelect,
          where: { type: { in: [AthleteMediaType.AVATAR, AthleteMediaType.CCCD_FRONT, AthleteMediaType.CCCD_BACK, AthleteMediaType.PASSPORT] } },
        },
      },
    });
    if (!athlete) throw new NotFoundException('Không tìm thấy vận động viên');
    if (status === RegistrationStatus.CONFIRMED) {
      const mediaState = registrationMediaState(athlete.media);
      this.assertRequiredRegistrationMedia(mediaState);
      if (!mediaState.verified) throw new BadRequestException('Chỉ có thể xác nhận khi CCCD hai mặt hoặc hộ chiếu đã được xác thực');
    }
    if (
      status === RegistrationStatus.CONFIRMED
      && registration.paymentStatus !== PaymentStatus.PAID
      && registration.paymentStatus !== PaymentStatus.NOT_REQUIRED
    ) {
      throw new BadRequestException('Hồ sơ phải hoàn tất thanh toán trước khi xác nhận tham dự');
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.eventRegistration.update({
        where: { id },
        data: {
          status,
          statusReason: normalizedReason,
          statusChangedAt: new Date(),
          statusChangedBy: changedBy || 'CMS',
        },
      });
      await transaction.registrationStatusHistory.create({
        data: {
          registrationId: id,
          fromStatus: registration.status,
          toStatus: status,
          reason: normalizedReason,
          changedBy: changedBy || 'CMS',
        },
      });
      await this.syncCompetitionEntry(transaction, {
        eventId: registration.eventId,
        categoryId: registration.categoryId,
        athleteId: registration.athleteId,
        countryId: athlete.countryId,
        confirmed: status === RegistrationStatus.CONFIRMED,
      });
      const email = registration.account?.email || registration.submission?.contactEmail;
      if (status === RegistrationStatus.CONFIRMED && email) {
        await this.ticketEmailQueue.enqueueTicket(transaction, email, registration.ticketCode);
      }
      return transaction.eventRegistration.findUniqueOrThrow({
        where: { id },
        include: this.registrationInclude(),
      });
    });
    await this.notifications.notifyRegistration(
      this.prisma,
      id,
      'REGISTRATION_STATUS',
      'Trạng thái đăng ký đã thay đổi',
      `${registration.status} → ${status}${normalizedReason ? ` · ${normalizedReason}` : ''}`,
    );
    return updated;
  }

  async updateRegistrationPaymentStatus(id: string, status: PaymentStatus, reason: string, changedBy?: string) {
    const registration = await this.prisma.eventRegistration.findUnique({ where: { id } });
    if (!registration) throw new NotFoundException('Không tìm thấy lượt đăng ký');
    if (registration.paymentStatus === status) throw new BadRequestException('Thanh toán đang ở trạng thái này');
    if (status === PaymentStatus.NOT_REQUIRED && registration.feeAmount > 0) {
      throw new BadRequestException('Hồ sơ có lệ phí không thể chuyển sang trạng thái miễn thanh toán');
    }
    const normalizedReason = reason.trim();
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.eventRegistration.update({
        where: { id },
        data: {
          paymentStatus: status,
          paymentStatusReason: normalizedReason,
          paymentStatusChangedAt: new Date(),
          paymentStatusChangedBy: changedBy || 'CMS',
        },
      });
      await transaction.paymentStatusHistory.create({
        data: {
          registrationId: id,
          fromStatus: registration.paymentStatus,
          toStatus: status,
          reason: normalizedReason,
          changedBy: changedBy || 'CMS',
        },
      });
      if (status === PaymentStatus.PAID) {
        await transaction.paymentTransaction.updateMany({
          where: { registrationId: id, status: PaymentTransactionStatus.PENDING },
          data: {
            status: PaymentTransactionStatus.PAID,
            paidAt: new Date(),
            failureReason: null,
            responsePayload: { manuallyApproved: true, reason: normalizedReason, changedBy: changedBy || 'CMS' },
          },
        });
      } else if (status === PaymentStatus.FAILED) {
        await transaction.paymentTransaction.updateMany({
          where: { registrationId: id, status: PaymentTransactionStatus.PENDING },
          data: { status: PaymentTransactionStatus.FAILED, failureReason: normalizedReason },
        });
      }
      return transaction.eventRegistration.findUniqueOrThrow({
        where: { id },
        include: this.registrationInclude(),
      });
    });
    if (status === PaymentStatus.PAID) {
      const finalized = await this.finalizePaidRegistration(id);
      if (finalized) Object.assign(updated, { status: RegistrationStatus.CONFIRMED, statusChangedAt: finalized.statusChangedAt });
    }
    await this.notifications.notifyRegistration(
      this.prisma,
      id,
      'REGISTRATION_PAYMENT',
      'Trạng thái thanh toán đã thay đổi',
      `${registration.paymentStatus} → ${status}${normalizedReason ? ` · ${normalizedReason}` : ''}`,
    );
    return updated;
  }

  async finalizePaidRegistration(id: string) {
    const finalized = await this.prisma.$transaction(async (transaction) => {
      const registration = await transaction.eventRegistration.findUnique({
        where: { id }, include: { submission: true, athlete: { include: {
          media: { select: registrationMediaSelect },
        } } },
      });
      if (!registration || registration.status !== RegistrationStatus.SUBMITTED || registration.paymentStatus !== PaymentStatus.PAID
        || !registrationMediaState(registration.athlete.media).complete
        || !registrationMediaState(registration.athlete.media).verified) return null;
      const statusChangedAt = new Date();
      const changed = await transaction.eventRegistration.updateMany({
        where: { id, status: RegistrationStatus.SUBMITTED, paymentStatus: PaymentStatus.PAID },
        data: { status: RegistrationStatus.CONFIRMED, statusChangedAt, statusChangedBy: 'SYSTEM:PAYMENT_CONFIRMED',
          statusReason: 'Hồ sơ đã xác thực và thanh toán thành công' },
      });
      if (!changed.count) return null;
      await this.syncCompetitionEntry(transaction, { eventId: registration.eventId, categoryId: registration.categoryId,
        athleteId: registration.athleteId, countryId: registration.athlete.countryId, confirmed: true });
      await transaction.registrationStatusHistory.create({ data: {
        registrationId: id, fromStatus: RegistrationStatus.SUBMITTED, toStatus: RegistrationStatus.CONFIRMED,
        reason: 'Hồ sơ đã xác thực và thanh toán thành công', changedBy: 'SYSTEM:PAYMENT_CONFIRMED',
      } });
      const email = registration.submission?.contactEmail || registration.athlete.email;
      if (email) {
        await this.ticketEmailQueue.enqueueTicket(transaction, email, registration.ticketCode);
      }
      return { ticketCode: registration.ticketCode, statusChangedAt, email };
    });
    return finalized;
  }

  private async syncCompetitionEntry(
    transaction: Prisma.TransactionClient,
    input: { eventId: string; categoryId: string; athleteId: string; countryId: string; confirmed: boolean },
  ) {
    const compoundKey = {
      eventId_categoryId_athleteId: {
        eventId: input.eventId,
        categoryId: input.categoryId,
        athleteId: input.athleteId,
      },
    };
    if (input.confirmed) {
      await transaction.competitionEntry.upsert({
        where: compoundKey,
        create: {
          eventId: input.eventId,
          categoryId: input.categoryId,
          athleteId: input.athleteId,
          countryId: input.countryId,
          type: EntryType.INDIVIDUAL,
          status: EntryStatus.VERIFIED,
        },
        update: { status: EntryStatus.VERIFIED, countryId: input.countryId },
      });
      await transaction.athlete.update({
        where: { id: input.athleteId },
        data: {
          events: { connect: { id: input.eventId } },
          categories: { connect: { id: input.categoryId } },
        },
      });
      return;
    }
    await transaction.competitionEntry.updateMany({
      where: { eventId: input.eventId, categoryId: input.categoryId, athleteId: input.athleteId },
      data: { status: EntryStatus.WITHDRAWN },
    });
  }

  private registrationInclude() {
    return {
      event: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          location: true,
          logoUrl: true,
          ticketBackgroundSize: true,
          updatedAt: true,
          ticketDesign: true,
          ticketThemePreset: true,
          ticketLayout: true,
          ticketPrimaryColor: true,
          ticketSecondaryColor: true,
          ticketAccentColor: true,
          sport: true,
          organizer: true,
        },
      },
      category: { include: { sport: true } },
      athlete: {
        include: {
          country: true,
          federation: true,
          statistics: {
            select: {
              eventId: true,
              sportId: true,
              categoryId: true,
              totalWins: true,
              totalLosses: true,
              totalDraws: true,
              totalMatches: true,
              goldMedals: true,
              silverMedals: true,
              bronzeMedals: true,
            },
          },
          media: { select: mediaSelect, orderBy: { type: 'asc' as const } },
        },
      },
      submission: true,
      paymentTransactions: {
        orderBy: { createdAt: 'desc' as const },
        take: 5,
      },
      statusHistory: { orderBy: { createdAt: 'desc' as const }, take: 10 },
      paymentStatusHistory: { orderBy: { createdAt: 'desc' as const }, take: 10 },
    } as const;
  }

  private identityDocumentState(
    media: Array<{ type: AthleteMediaType; verificationStatus: DocumentVerificationStatus | null }>,
  ) {
    const byType = new Map(media.map((item) => [item.type, item.verificationStatus]));
    const hasCccd = byType.has(AthleteMediaType.CCCD_FRONT) && byType.has(AthleteMediaType.CCCD_BACK);
    const hasPassport = byType.has(AthleteMediaType.PASSPORT);
    const cccdVerified = hasCccd
      && byType.get(AthleteMediaType.CCCD_FRONT) === DocumentVerificationStatus.VERIFIED
      && byType.get(AthleteMediaType.CCCD_BACK) === DocumentVerificationStatus.VERIFIED;
    const passportVerified = hasPassport
      && byType.get(AthleteMediaType.PASSPORT) === DocumentVerificationStatus.VERIFIED;
    return { complete: hasCccd || hasPassport, verified: cccdVerified || passportVerified };
  }

  private assertRequiredRegistrationMedia(state: ReturnType<typeof registrationMediaState>) {
    if (!state.hasAvatar) throw new BadRequestException('Cần tải ảnh đại diện trước khi đăng ký hoặc xác nhận tham gia');
    if (!state.hasIdentityDocuments) throw new BadRequestException('Cần tải đủ CCCD hai mặt hoặc hộ chiếu trước khi đăng ký hoặc xác nhận tham gia');
  }

  private async autoVerifyIdentityMedia(athleteId: string, database: Prisma.TransactionClient = this.prisma) {
    await database.athleteMedia.updateMany({
      where: {
        athleteId,
        type: { in: [AthleteMediaType.CCCD_FRONT, AthleteMediaType.CCCD_BACK, AthleteMediaType.PASSPORT] },
        verificationStatus: { not: DocumentVerificationStatus.VERIFIED },
      },
      data: {
        verificationStatus: DocumentVerificationStatus.VERIFIED,
        verificationNote: 'Tự động duyệt vì OCR CCCD / Hộ chiếu đang tắt.',
        verifiedAt: new Date(),
        verifiedBy: 'SYSTEM:OCR_DISABLED',
      },
    });
  }

  private aggregateStatistics(statistics: Array<{
    totalWins: number;
    totalLosses: number;
    totalDraws: number;
    totalMatches: number;
    goldMedals: number;
    silverMedals: number;
    bronzeMedals: number;
  }>) {
    return statistics.reduce((total, item) => ({
      totalWins: total.totalWins + item.totalWins,
      totalLosses: total.totalLosses + item.totalLosses,
      totalDraws: total.totalDraws + item.totalDraws,
      totalMatches: total.totalMatches + item.totalMatches,
      goldMedals: total.goldMedals + item.goldMedals,
      silverMedals: total.silverMedals + item.silverMedals,
      bronzeMedals: total.bronzeMedals + item.bronzeMedals,
    }), {
      totalWins: 0,
      totalLosses: 0,
      totalDraws: 0,
      totalMatches: 0,
      goldMedals: 0,
      silverMedals: 0,
      bronzeMedals: 0,
    });
  }

  private mediaCreate(
    type: AthleteMediaType,
    file: RegistrationMediaFile,
    requiresVerification: boolean,
    previewOcr?: GuestAthleteInput['identityOcr'],
    autoVerify = false,
  ) {
    const hasConfirmedPreview = Boolean(previewOcr?.userConfirmed && previewOcr.fields);
    return {
      type,
      storageKey: file.storageKey,
      mimeType: file.mimetype,
      size: file.size,
      verificationStatus: requiresVerification
        ? autoVerify
          ? DocumentVerificationStatus.VERIFIED
          : DocumentVerificationStatus.PENDING
        : null,
      verificationNote: requiresVerification && autoVerify
        ? 'Tự động duyệt vì OCR CCCD / Hộ chiếu đang tắt.'
        : null,
      verifiedAt: requiresVerification && autoVerify ? new Date() : null,
      verifiedBy: requiresVerification && autoVerify ? 'SYSTEM:OCR_DISABLED' : null,
      ...(hasConfirmedPreview ? {
        ocrStatus: DocumentOcrStatus.COMPLETED,
        ocrProvider: previewOcr?.provider?.slice(0, 50) || 'FPT_AI',
        ocrConfidence: typeof previewOcr?.confidence === 'number' ? previewOcr.confidence : null,
        ocrData: {
          fields: previewOcr?.fields || {},
          fieldConfidence: previewOcr?.fieldConfidence || {},
          confirmedFields: previewOcr?.fields || {},
          userConfirmed: true,
          confirmedAt: new Date().toISOString(),
          source: 'PUBLIC_PREVIEW',
        } as Prisma.InputJsonValue,
      } : {}),
    } satisfies Prisma.AthleteMediaCreateWithoutAthleteInput;
  }

  private ocrPersistence(result: IdentityOcrResult) {
    const status = result.status === 'COMPLETED'
      ? DocumentOcrStatus.COMPLETED
      : result.status === 'FAILED'
        ? DocumentOcrStatus.FAILED
        : DocumentOcrStatus.NOT_REQUESTED;
    return {
      ocrStatus: status,
      ocrProvider: result.provider,
      ocrConfidence: result.confidence,
      ocrData: {
        fields: result.fields,
        fieldConfidence: result.fieldConfidence,
        userConfirmed: false,
        ...(result.message ? { message: result.message } : {}),
      } as Prisma.InputJsonValue,
    };
  }

  private ocrGender(value?: string) {
    if (!value) return null;
    const normalized = value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (['nam', 'male', 'm'].includes(normalized)) return Gender.MALE;
    if (['nu', 'female', 'f'].includes(normalized)) return Gender.FEMALE;
    return null;
  }

  private validateRegistrationWindow(event: {
    registrationEnabled: boolean;
    registrationOpenAt: Date | null;
    registrationCloseAt: Date | null;
    startDate: Date;
  }) {
    if (!event.registrationEnabled) throw new BadRequestException('Sự kiện chưa mở đăng ký');
    const now = new Date();
    if (event.registrationOpenAt && now < event.registrationOpenAt) {
      throw new BadRequestException('Chưa đến thời gian đăng ký');
    }
    const closeAt = event.registrationCloseAt || event.startDate;
    if (now > closeAt) throw new BadRequestException('Đã hết thời gian đăng ký');
  }

  private validateAthleteForCategory(
    athlete: { gender: Gender; birthDate: Date | null; weight?: number | null },
    category: { gender: Gender; minAge: number | null; maxAge: number | null; minWeight: number | null; maxWeight: number | null },
    eventDate: Date,
  ) {
    if (!athlete.birthDate) throw new BadRequestException('Hồ sơ chưa có ngày sinh');
    if (category.gender !== Gender.MIXED && category.gender !== athlete.gender) {
      throw new BadRequestException('Giới tính không phù hợp với hạng đấu');
    }
    const age = this.ageAt(athlete.birthDate, eventDate);
    if (category.minAge !== null && age < category.minAge) {
      throw new BadRequestException(`Vận động viên phải đủ ${category.minAge} tuổi vào ngày thi đấu`);
    }
    if (category.maxAge !== null && age > category.maxAge) {
      throw new BadRequestException(`Hạng đấu chỉ nhận vận động viên tối đa ${category.maxAge} tuổi`);
    }
    if (athlete.weight && category.minWeight !== null && athlete.weight < category.minWeight) {
      throw new BadRequestException(`Cân nặng tối thiểu của hạng đấu là ${category.minWeight} kg`);
    }
    if (athlete.weight && category.maxWeight !== null && athlete.weight > category.maxWeight) {
      throw new BadRequestException(`Cân nặng tối đa của hạng đấu là ${category.maxWeight} kg`);
    }
  }

  private ageAt(birthDate: Date, date: Date) {
    let age = date.getUTCFullYear() - birthDate.getUTCFullYear();
    const beforeBirthday = date.getUTCMonth() < birthDate.getUTCMonth()
      || (date.getUTCMonth() === birthDate.getUTCMonth() && date.getUTCDate() < birthDate.getUTCDate());
    if (beforeBirthday) age -= 1;
    return age;
  }

  private validateFile(type: AthleteMediaType, file: RegistrationMediaFile) {
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const allowed = type === AthleteMediaType.AVATAR ? imageTypes : [...imageTypes, 'application/pdf'];
    if (!allowed.includes(file.mimetype)) throw new BadRequestException('Chỉ hỗ trợ JPG, PNG, WebP hoặc PDF');
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 8 * 1024 * 1024) throw new BadRequestException('Tệp phải có dữ liệu và không được vượt quá 8 MB');
    // Staged files were validated before upload; the reference comes from the DB.
    if (!file.storageKey && !this.hasValidFileSignature(file)) {
      throw new BadRequestException('Nội dung tệp không đúng định dạng ảnh hoặc PDF đã khai báo');
    }
  }

  private hasValidFileSignature(file: RegistrationMediaFile) {
    const bytes = file.buffer;
    if (file.mimetype === 'image/jpeg') {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (file.mimetype === 'image/png') {
      return bytes.length >= 8
        && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (file.mimetype === 'image/webp') {
      return bytes.length >= 12
        && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
        && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    if (file.mimetype === 'application/pdf') {
      return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    }
    return false;
  }

  private async validateAffiliation(countryId: string, federationId?: string) {
    const country = await this.prisma.country.findUnique({ where: { id: countryId } });
    if (!country) throw new BadRequestException('Quốc gia không tồn tại');
    if (!federationId) return;
    const federation = await this.prisma.federation.findUnique({ where: { id: federationId } });
    if (!federation) throw new BadRequestException('Đơn vị không tồn tại');
    if (federation.countryId !== countryId) throw new BadRequestException('Đơn vị và vận động viên phải cùng quốc gia');
  }

  private splitName(displayName: string) {
    const parts = displayName.trim().split(/\s+/);
    return { firstName: parts.at(-1) || displayName, lastName: parts.slice(0, -1).join(' ') || parts[0] };
  }

  private ticketCode() {
    return `SD-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
  }

  private submissionReference() {
    return `SDR-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private paymentDueAt(createdAt: Date) {
    const configured = Number(process.env.UNPAID_REGISTRATION_TTL_HOURS || 24);
    const hours = Number.isFinite(configured) && configured > 0 ? configured : 24;
    return new Date(createdAt.getTime() + hours * 60 * 60 * 1000).toISOString();
  }

  private sign(id: string, email: string) {
    return this.jwtService.sign(
      { sub: id, email, type: 'participant', sessionIssuedAt: Date.now() },
      {
        secret: process.env.JWT_SECRET || 'sportdata-dev-secret-change-me-please',
        expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
      },
    );
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async sendResetEmail(email: string, resetUrl: string, ttlMinutes: number) {
    const integration = await this.systemSettings.integrationValues();

    if (!integration.SMTP_HOST) return;
    const transporter = nodemailer.createTransport({
      host: integration.SMTP_HOST,
      port: Number(integration.SMTP_PORT || 587),
      secure: integration.SMTP_SECURE === 'true',
      ...(integration.SMTP_USER
        ? { auth: { user: integration.SMTP_USER, pass: integration.SMTP_PASSWORD || '' } }
        : {}),
    });
    await transporter.sendMail({
      from: integration.SMTP_FROM || integration.SMTP_USER || 'SportData',
      to: email,
      subject: 'Đặt lại mật khẩu tài khoản SportData',
      text: `Mở liên kết sau để đặt lại mật khẩu SportData. Liên kết hết hạn sau ${ttlMinutes} phút và chỉ dùng được một lần:\n\n${resetUrl}`,
      html: `<p>Bạn vừa yêu cầu đặt lại mật khẩu tài khoản SportData.</p><p><a href="${resetUrl}">Đặt lại mật khẩu</a></p><p>Liên kết hết hạn sau ${ttlMinutes} phút và chỉ dùng được một lần.</p>`,
    });
  }
}
