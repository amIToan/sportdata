import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AthleteMediaType, DocumentVerificationStatus, EventParticipationRole, Gender, RegistrationStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventParticipationDto, UpdateEventParticipationStatusDto } from './dto/create-event-participation.dto';
import { TicketEmailQueueService } from './ticket-email-queue.service';
import { StorageService } from '../storage/storage.service';
import { TicketNotFoundException, TicketNotIssuedException } from './ticket-availability.exceptions';
import { AthleteIdentityService } from '../athletes/athlete-identity.service';
import type { ImageVariant } from '../storage/image-variant';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { registrationMediaState } from './registration-media-state';

const registrationRoles: EventParticipationRole[] = [EventParticipationRole.REFEREE, EventParticipationRole.TEAM_LEADER, EventParticipationRole.COACH];
const federationRequiredRoles: EventParticipationRole[] = [EventParticipationRole.TEAM_LEADER];

const roleLabels: Record<EventParticipationRole, string> = {
  ATTENDEE: 'Người tham gia bình thường', REFEREE: 'Trọng tài', TEAM_LEADER: 'Trưởng đoàn',
  COACH: 'Huấn luyện viên', MEDICAL_STAFF: 'Nhân viên y tế',
};

const participationInclude = {
  event: { select: { id: true, name: true, startDate: true, location: true } },
  federation: { select: { id: true, name: true } },
  media: { select: { type: true, mimeType: true, size: true, verificationStatus: true } },
} as const;

@Injectable()
export class EventParticipationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketEmailQueue: TicketEmailQueueService,
    private readonly storage: StorageService,
    private readonly identity: AthleteIdentityService,
    private readonly settings: SystemSettingsService,
  ) {}

  async create(dto: CreateEventParticipationDto, accountId?: string) {
    if (!registrationRoles.includes(dto.role)) {
      throw new BadRequestException('Vai trò này không được đăng ký tham gia sự kiện');
    }
    const event = await this.prisma.event.findUnique({ where: { id: dto.eventId }, include: {
      participatingFederations: { select: { id: true } },
    } });
    if (!event?.isPublished) throw new NotFoundException('Sự kiện không tồn tại hoặc chưa công khai');
    const now = new Date();
    if (!event.registrationEnabled) throw new BadRequestException('Sự kiện chưa mở đăng ký');
    if (event.registrationOpenAt && now < event.registrationOpenAt) throw new BadRequestException('Chưa đến thời gian đăng ký');
    if (now > (event.registrationCloseAt || event.startDate)) throw new BadRequestException('Đã hết thời gian đăng ký');

    const account = accountId ? await this.prisma.participantAccount.findUnique({ where: { id: accountId } }) : null;
    if (accountId && !account?.isActive) throw new BadRequestException('Tài khoản không còn hoạt động');
    const contactName = (account?.displayName || dto.contactName || '').trim();
    const contactEmail = (account?.email || dto.contactEmail || '').trim().toLowerCase();
    const contactPhone = (dto.contactPhone || account?.phone || '').trim();
    if (contactName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BadRequestException('Vui lòng nhập họ tên và email liên hệ hợp lệ');
    }
    if (federationRequiredRoles.includes(dto.role) && !dto.federationId) {
      throw new BadRequestException('Vui lòng chọn đơn vị / CLB đại diện');
    }
    if (dto.federationId) {
      const federation = await this.prisma.federation.findUnique({ where: { id: dto.federationId } });
      if (!federation) throw new BadRequestException('Liên đoàn không tồn tại');
      if (event.participatingFederations.length && !event.participatingFederations.some((item) => item.id === federation.id)) {
        throw new BadRequestException('Liên đoàn chưa nằm trong danh sách tham gia sự kiện');
      }
    }
    if (!['CCCD', 'PASSPORT'].includes(dto.identityType) || !dto.documentNumber?.trim()) {
      throw new BadRequestException('Vui lòng nhập số CCCD hoặc hộ chiếu');
    }
    const identity = this.identity.normalize({
      fullName: contactName, gender: Gender.MALE, countryId: '',
      identityType: dto.identityType, documentNumber: dto.documentNumber,
    });
    if (!identity.cccdEncrypted && !identity.passportEncrypted) {
      throw new BadRequestException('Số CCCD phải có 12 chữ số; số hộ chiếu phải có 5–20 ký tự chữ hoặc số.');
    }
    const requiredMedia: Array<[keyof CreateEventParticipationDto['mediaUploads'], AthleteMediaType]> = [['avatar', AthleteMediaType.AVATAR]];
    if (dto.identityType === 'CCCD') requiredMedia.push(['cccdFront', AthleteMediaType.CCCD_FRONT], ['cccdBack', AthleteMediaType.CCCD_BACK]);
    else requiredMedia.push(['passport', AthleteMediaType.PASSPORT]);
    const references = requiredMedia.map(([key, type]) => {
      const reference = dto.mediaUploads?.[key];
      if (!reference?.id || !reference.token) throw new BadRequestException('Vui lòng tải lên đủ ảnh thẻ và giấy tờ định danh');
      return { ...reference, type };
    });
    if (new Set(references.map((item) => item.id)).size !== references.length) {
      throw new BadRequestException('Mỗi tệp tải lên chỉ được sử dụng một lần');
    }
    const autoVerifyIdentity = !(await this.settings.get()).values.identityOcrEnabled;
    try {
      const participation = await this.prisma.$transaction(async (transaction) => {
        const uploads = await transaction.participantMediaUpload.findMany({ where: {
          id: { in: references.map((item) => item.id) }, expiresAt: { gt: new Date() },
        } });
        const media = references.map((reference) => {
          const upload = uploads.find((item) => item.id === reference.id);
          if (!upload?.storageKey || upload.type !== reference.type
            || upload.tokenHash !== createHash('sha256').update(reference.token).digest('hex')) {
            throw new BadRequestException('Tệp tải lên đã hết hạn hoặc không hợp lệ. Vui lòng chọn lại tệp.');
          }
          const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
          const allowedTypes = upload.type === AthleteMediaType.AVATAR ? imageTypes : [...imageTypes, 'application/pdf'];
          if (!allowedTypes.includes(upload.mimeType) || upload.size <= 0 || upload.size > 8 * 1024 * 1024) {
            throw new BadRequestException('Tệp đăng ký phải là ảnh hoặc PDF hợp lệ và không vượt quá 8 MB');
          }
          const isIdentity = upload.type !== AthleteMediaType.AVATAR;
          return { type: upload.type, storageKey: upload.storageKey, mimeType: upload.mimeType, size: upload.size,
            verificationStatus: isIdentity ? autoVerifyIdentity ? DocumentVerificationStatus.VERIFIED : DocumentVerificationStatus.PENDING : null,
            verifiedAt: isIdentity && autoVerifyIdentity ? new Date() : null,
            verifiedBy: isIdentity && autoVerifyIdentity ? 'SYSTEM:OCR_DISABLED' : null };
        });
        const consumed = await transaction.participantMediaUpload.deleteMany({ where: {
          id: { in: references.map((item) => item.id) }, expiresAt: { gt: new Date() },
        } });
        if (consumed.count !== references.length) {
          throw new BadRequestException('Tệp tải lên đã được sử dụng hoặc hết hạn. Vui lòng tải lại tệp.');
        }
        return transaction.eventParticipation.create({ data: {
          eventId: event.id, accountId, role: dto.role, contactName, contactEmail,
          contactPhone: contactPhone || null, federationId: dto.federationId,
          identityType: dto.identityType,
          documentEncrypted: identity.cccdEncrypted || identity.passportEncrypted,
          media: { create: media },
          referenceCode: `SDP-${now.getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`,
          status: RegistrationStatus.SUBMITTED,
        }, include: participationInclude });
      });
      return this.serialize(participation);
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Bạn đã đăng ký vai trò này trong sự kiện. Vui lòng kiểm tra hồ sơ đã gửi.');
      throw error;
    }
  }

  async listMine(accountId: string, eventId?: string) {
    const records = await this.prisma.eventParticipation.findMany({
      where: { accountId, ...(eventId ? { eventId } : {}) }, include: participationInclude, orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => this.serialize(record));
  }

  async listAdmin(eventId?: string) {
    const records = await this.prisma.eventParticipation.findMany({
      where: eventId ? { eventId } : {}, include: participationInclude, orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => this.serialize(record, true));
  }

  private serialize<T extends { documentEncrypted?: string | null; identityType?: string | null }>(record: T, includeDocument = false) {
    const { documentEncrypted, ...publicRecord } = record;
    return { ...publicRecord, ...(includeDocument && documentEncrypted && record.identityType && ['CCCD', 'PASSPORT'].includes(record.identityType)
      ? { documentNumber: this.identity.decrypt(documentEncrypted, record.identityType as 'CCCD' | 'PASSPORT') } : {}) };
  }

  async getAdminMedia(id: string, type: string, variant?: ImageVariant) {
    if (!Object.values(AthleteMediaType).includes(type as AthleteMediaType)) throw new NotFoundException('Loại tệp không hợp lệ');
    const media = await this.prisma.eventParticipationMedia.findUnique({
      where: { participationId_type: { participationId: id, type: type as AthleteMediaType } },
    });
    if (!media) throw new NotFoundException('Chưa có tệp này');
    return { data: await this.storage.read(media.storageKey, variant), mimeType: media.mimeType };
  }

  async getPublicAvatar(id: string, variant?: ImageVariant) {
    const participation = await this.prisma.eventParticipation.findUnique({ where: { id }, select: { status: true } });
    if (participation?.status !== RegistrationStatus.CONFIRMED) throw new NotFoundException('Thẻ chưa được phát hành');
    return this.getAdminMedia(id, AthleteMediaType.AVATAR, variant);
  }

  async updateStatus(id: string, dto: UpdateEventParticipationStatusDto, actor: string) {
    if (dto.reason.trim().length < 2) throw new BadRequestException('Vui lòng nhập lý do cập nhật trạng thái');
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM "EventParticipation" WHERE id = ${id} FOR UPDATE`;
      const previous = await transaction.eventParticipation.findUnique({ where: { id }, include: { media: true } });
      if (!previous) throw new NotFoundException('Không tìm thấy hồ sơ tham gia');
      if (dto.status === RegistrationStatus.CONFIRMED) {
        if (!registrationMediaState(previous.media, previous.identityType).complete) {
          throw new BadRequestException('Hồ sơ tham gia phải có ảnh đại diện và đủ CCCD hai mặt hoặc hộ chiếu trước khi duyệt');
        }
        await transaction.eventParticipationMedia.updateMany({ where: {
          participationId: id, type: { not: AthleteMediaType.AVATAR }, verificationStatus: DocumentVerificationStatus.PENDING,
        }, data: { verificationStatus: DocumentVerificationStatus.VERIFIED, verifiedAt: new Date(), verifiedBy: actor } });
      }
      const updated = await transaction.eventParticipation.update({ where: { id }, data: {
        status: dto.status, statusReason: dto.reason.trim(), statusChangedAt: new Date(), statusChangedBy: actor,
      }, include: participationInclude });
      if (dto.status === RegistrationStatus.CONFIRMED && previous.status !== RegistrationStatus.CONFIRMED) {
        await this.ticketEmailQueue.enqueueTicket(transaction, updated.contactEmail, updated.referenceCode);
      }
      return this.serialize(updated, true);
    });
  }

  async getTicket(code: string, includeAssets = false) {
    const participation = await this.prisma.eventParticipation.findUnique({
      where: { referenceCode: code.trim().toUpperCase() },
      include: { event: { include: { sport: true } }, federation: { select: { name: true } },
        media: { where: { type: AthleteMediaType.AVATAR } } },
    });
    if (!participation) throw new TicketNotFoundException('Không tìm thấy thẻ tham dự');
    const event = participation.event;
    const avatar = participation.media.find((item) => item.type === AthleteMediaType.AVATAR);
    return {
      ticketCode: participation.referenceCode,
      role: participation.role,
      roleLabel: roleLabels[participation.role],
      status: participation.status,
      isValid: participation.status === RegistrationStatus.CONFIRMED,
      issuedAt: participation.status === RegistrationStatus.CONFIRMED ? participation.statusChangedAt : null,
      paymentStatus: 'NOT_REQUIRED',
      event: {
        id: event.id, name: event.name, startDate: event.startDate, endDate: event.endDate, location: event.location,
        logoUrl: event.logoUrl, ticketDesign: event.ticketDesign, ticketThemePreset: event.ticketThemePreset,
        ticketLayout: event.ticketLayout, ticketPrimaryColor: event.ticketPrimaryColor,
        ticketSecondaryColor: event.ticketSecondaryColor, ticketAccentColor: event.ticketAccentColor,
        ticketBackgroundUrl: event.ticketBackgroundSize
          ? `/api/events/${event.id}/ticket-background?v=${event.updatedAt.getTime()}` : null,
      },
      sport: { name: event.sport.name },
      category: { name: roleLabels[participation.role] },
      // Compatibility projection for the shared card renderer; no Athlete is created.
      athlete: { fullName: participation.contactName, federation: participation.federation,
        avatarUrl: avatar && participation.status === RegistrationStatus.CONFIRMED
          ? `/api/participant-auth/event-participations/${participation.id}/avatar?v=${participation.updatedAt.getTime()}` : null },
      ...(includeAssets ? { assets: {
        backgroundData: event.ticketBackgroundStorageKey ? await this.storage.read(event.ticketBackgroundStorageKey) : null,
        backgroundMimeType: event.ticketBackgroundMimeType,
        avatarData: avatar && participation.status === RegistrationStatus.CONFIRMED ? await this.storage.read(avatar.storageKey) : null,
        avatarMimeType: avatar?.mimeType,
      } } : {}),
    };
  }

  async getIssuedTicket(code: string, includeAssets = false) {
    const ticket = await this.getTicket(code, includeAssets);
    if (!ticket.isValid) throw new TicketNotIssuedException('Vé chỉ được phát hành sau khi hồ sơ tham gia được duyệt');
    return ticket;
  }
}
