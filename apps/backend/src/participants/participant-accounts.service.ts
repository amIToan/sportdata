import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountVerificationStatus, AthleteMediaType, Prisma, SportDataAccountType } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AthleteIdentityService } from '../athletes/athlete-identity.service';
import type { ImageVariant } from '../storage/image-variant';
import { ListParticipantAccountsDto } from './dto/list-participant-accounts.dto';
import { DeletePersonnelDto } from './dto/delete-personnel.dto';
import {
  accountDocumentMimeTypes, accountImageMimeTypes, accountProfileState, accountProfileMediaTypes,
  selectAccountProfileSource, usableAccountMedia,
} from './participant-account-profile';

const mediaSelect = {
  type: true, storageKey: true, mimeType: true, size: true, verificationStatus: true,
} as const;

function mediaWhere(type: AthleteMediaType) {
  return { type, storageKey: { not: '' }, size: { gt: 0, lte: 8 * 1024 * 1024 },
    mimeType: { in: type === AthleteMediaType.AVATAR ? accountImageMimeTypes : accountDocumentMimeTypes } };
}

const completeParticipationWhere: Prisma.EventParticipationWhereInput = {
  AND: [
    { media: { some: mediaWhere(AthleteMediaType.AVATAR) } },
    { OR: [
      { identityType: { equals: 'CCCD', not: null }, AND: [
        { media: { some: mediaWhere(AthleteMediaType.CCCD_FRONT) } },
        { media: { some: mediaWhere(AthleteMediaType.CCCD_BACK) } },
      ] },
      { identityType: { equals: 'PASSPORT', not: null }, media: { some: mediaWhere(AthleteMediaType.PASSPORT) } },
      { AND: [
        { OR: [{ identityType: null }, { identityType: { notIn: ['CCCD', 'PASSPORT'] } }] },
        { OR: [
          { AND: [
            { media: { some: mediaWhere(AthleteMediaType.CCCD_FRONT) } },
            { media: { some: mediaWhere(AthleteMediaType.CCCD_BACK) } },
          ] },
          { media: { some: mediaWhere(AthleteMediaType.PASSPORT) } },
        ] },
      ] },
    ] },
  ],
};

const missingCccdIdentity: Prisma.AthleteWhereInput = { OR: [
  { identity: { is: null } },
  { identity: { is: { OR: [{ cccdEncrypted: null }, { cccdEncrypted: '' }] } } },
] };

const missingPassportIdentity: Prisma.AthleteWhereInput = { OR: [
  { identity: { is: null } },
  { identity: { is: { OR: [{ passportEncrypted: null }, { passportEncrypted: '' }] } } },
] };

// Nullable comparisons need explicit presence guards: NOT(complete) must remain a
// boolean in PostgreSQL so legacy accounts cannot disappear from both filters.
const legacyCompleteProfileWhere: Prisma.ParticipantAccountWhereInput = { OR: [
  { identityType: { equals: 'CCCD', not: null }, athlete: { is: { AND: [
    { media: { some: mediaWhere(AthleteMediaType.AVATAR) } },
    { media: { some: mediaWhere(AthleteMediaType.CCCD_FRONT) } },
    { media: { some: mediaWhere(AthleteMediaType.CCCD_BACK) } },
  ] } } },
  { identityType: { equals: 'PASSPORT', not: null }, athlete: { is: { AND: [
    { media: { some: mediaWhere(AthleteMediaType.AVATAR) } },
    { media: { some: mediaWhere(AthleteMediaType.PASSPORT) } },
  ] } } },
  { AND: [
    { OR: [{ identityType: null }, { identityType: { notIn: ['CCCD', 'PASSPORT'] } }] },
    { athlete: { is: { AND: [
      { media: { some: mediaWhere(AthleteMediaType.AVATAR) } },
      { OR: [
        { identity: { is: { AND: [{ cccdEncrypted: { not: null } }, { cccdEncrypted: { not: '' } }] } }, AND: [
          { media: { some: mediaWhere(AthleteMediaType.CCCD_FRONT) } },
          { media: { some: mediaWhere(AthleteMediaType.CCCD_BACK) } },
        ] },
        { AND: [
          missingCccdIdentity,
          { identity: { is: { AND: [{ passportEncrypted: { not: null } }, { passportEncrypted: { not: '' } }] } } },
          { media: { some: mediaWhere(AthleteMediaType.PASSPORT) } },
        ] },
        { AND: [missingCccdIdentity, missingPassportIdentity, { OR: [
          { AND: [
            { media: { some: mediaWhere(AthleteMediaType.CCCD_FRONT) } },
            { media: { some: mediaWhere(AthleteMediaType.CCCD_BACK) } },
          ] },
          { media: { some: mediaWhere(AthleteMediaType.PASSPORT) } },
        ] }] },
      ] },
    ] } } },
  ] },
  { eventParticipations: { some: completeParticipationWhere } },
] };

const completeProfileWhere: Prisma.ParticipantAccountWhereInput = { OR: [
  { AND: [
    { athlete: { is: null } },
    { media: { some: mediaWhere(AthleteMediaType.AVATAR) } },
    { OR: [
      { identityType: { equals: 'CCCD', not: null }, AND: [
        { media: { some: mediaWhere(AthleteMediaType.CCCD_FRONT) } },
        { media: { some: mediaWhere(AthleteMediaType.CCCD_BACK) } },
      ] },
      { identityType: { equals: 'PASSPORT', not: null }, media: { some: mediaWhere(AthleteMediaType.PASSPORT) } },
    ] },
  ] },
  { AND: [
    { OR: [{ athlete: { isNot: null } }, { media: { none: {} } }] },
    legacyCompleteProfileWhere,
  ] },
] };

const accountSelect = {
  id: true, email: true, displayName: true, phone: true, accountType: true, accountTypes: true,
  representativePosition: true, verificationStatus: true, isActive: true, createdAt: true,
  identityType: true, documentEncrypted: true, media: { select: mediaSelect },
  federation: { select: { id: true, name: true, code: true, type: true, country: { select: { code: true, name: true } } } },
  athlete: { select: {
    identity: { select: { cccdEncrypted: true, passportEncrypted: true } },
    media: { select: mediaSelect },
  } },
  eventParticipations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
    select: { identityType: true, documentEncrypted: true, media: { select: mediaSelect } } },
} satisfies Prisma.ParticipantAccountSelect;

type AccountRecord = Prisma.ParticipantAccountGetPayload<{ select: typeof accountSelect }>;

@Injectable()
export class ParticipantAccountsService {
  private readonly logger = new Logger(ParticipantAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly identity: AthleteIdentityService,
  ) {}

  async eventHistory(accountId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const account = await transaction.participantAccount.findUnique({
        where: { id: accountId }, select: { id: true, athlete: { select: { id: true } } },
      });
      if (!account) throw new NotFoundException('Không tìm thấy hồ sơ');
      const eventSelect = { id: true, name: true, startDate: true, endDate: true, location: true } as const;
      const [participations, registrations] = await Promise.all([
        transaction.eventParticipation.findMany({
          where: { accountId }, orderBy: { createdAt: 'desc' },
          select: { id: true, role: true, status: true, referenceCode: true, createdAt: true,
            event: { select: eventSelect }, federation: { select: { name: true } } },
        }),
        transaction.eventRegistration.findMany({
          where: { OR: [{ accountId }, ...(account.athlete ? [{ athleteId: account.athlete.id }] : [])] },
          orderBy: { createdAt: 'desc' },
          select: { id: true, athleteId: true, status: true, ticketCode: true, createdAt: true,
            event: { select: eventSelect }, category: { select: { name: true } },
            athlete: { select: { fullName: true } }, federation: { select: { name: true } } },
        }),
      ]);
      type Event = { id: string; name: string; startDate: Date; endDate: Date; location: string | null };
      type Entry = { id: string; role: string; status: string; referenceCode: string; createdAt: Date;
        federationName: string | null; categoryName?: string; athleteName?: string };
      const grouped = new Map<string, { event: Event; entries: Entry[] }>();
      const add = (event: Event, entry: Entry) => {
        const group = grouped.get(event.id) || { event, entries: [] };
        group.entries.push(entry);
        grouped.set(event.id, group);
      };
      for (const entry of participations) add(entry.event, {
        id: entry.id, role: entry.role, status: entry.status, referenceCode: entry.referenceCode,
        createdAt: entry.createdAt, federationName: entry.federation?.name || null,
      });
      for (const entry of registrations) add(entry.event, {
        id: entry.id, role: entry.athleteId === account.athlete?.id ? 'ATHLETE' : 'REGISTRANT',
        status: entry.status, referenceCode: entry.ticketCode, createdAt: entry.createdAt,
        federationName: entry.federation?.name || null, categoryName: entry.category.name,
        athleteName: entry.athlete.fullName,
      });
      const items = [...grouped.values()].sort((a, b) => b.event.startDate.getTime() - a.event.startDate.getTime()
        || a.event.id.localeCompare(b.event.id));
      return { items, total: items.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async deletePersonnel(dto: DeletePersonnelDto) {
    if ((dto.all === true) === Boolean(dto.ids?.length)) {
      throw new BadRequestException('Chọn danh sách nhân sự hoặc xác nhận xóa tất cả');
    }
    const roles: SportDataAccountType[] = ['REFEREE', 'TEAM_LEADER', 'COACH'];
    const where: Prisma.ParticipantAccountWhereInput = {
      OR: [{ accountType: { in: roles } }, { accountTypes: { hasSome: roles } }],
      ...(dto.ids ? { id: { in: dto.ids } } : {}),
    };
    return this.prisma.$transaction(async (transaction) => {
      if (dto.ids && await transaction.participantAccount.count({ where }) !== dto.ids.length) {
        throw new BadRequestException('Một số hồ sơ không còn tồn tại hoặc không thuộc danh sách nhân sự. Vui lòng tải lại.');
      }
      // Event registrations and athlete records retain their data through the
      // existing ON DELETE SET NULL relationships. Shared media objects are kept.
      const deleted = await transaction.participantAccount.deleteMany({ where });
      return { deleted: deleted.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async list(query: ListParticipantAccountsDto) {
    const filters: Prisma.ParticipantAccountWhereInput[] = [];
    if (query.search) {
      const contains = { contains: query.search, mode: Prisma.QueryMode.insensitive };
      filters.push({ OR: [
        { displayName: contains }, { email: contains }, { phone: contains },
        { representativePosition: contains }, { federation: { is: { name: contains } } },
      ] });
    }
    if (query.accountType) filters.push({ OR: [{ accountType: query.accountType }, { accountTypes: { has: query.accountType } }] });
    if (query.accountGroup === 'PERSONNEL') {
      const roles: SportDataAccountType[] = ['REFEREE', 'TEAM_LEADER', 'COACH'];
      filters.push({ OR: [{ accountType: { in: roles } }, { accountTypes: { hasSome: roles } }] });
    }
    if (query.verificationStatus) filters.push({ verificationStatus: query.verificationStatus });
    if (query.isActive !== undefined) filters.push({ isActive: query.isActive });
    if (query.federationId) filters.push({ federationId: query.federationId === 'none' ? null : query.federationId });
    if (query.profileStatus) filters.push(query.profileStatus === 'COMPLETE' ? completeProfileWhere : { NOT: completeProfileWhere });
    const where: Prisma.ParticipantAccountWhereInput = { AND: filters };
    const page = query.page || 1;
    const limit = query.limit || 20;
    return this.prisma.$transaction(async (transaction) => {
      const [accounts, total, complete, pending] = await Promise.all([
        transaction.participantAccount.findMany({
          where, select: accountSelect, skip: (page - 1) * limit, take: limit,
          orderBy: [{ [query.sortBy || 'createdAt']: query.sortOrder || 'desc' }, { id: 'desc' }],
        }),
        transaction.participantAccount.count({ where }),
        transaction.participantAccount.count({ where: { AND: [where, completeProfileWhere] } }),
        transaction.participantAccount.count({ where: { AND: [where, { verificationStatus: AccountVerificationStatus.PENDING }] } }),
      ]);
      await this.addCompleteFallbacks(accounts, transaction);
      return {
        items: accounts.map((account) => this.serialize(account)), total, page, limit,
        summary: { total, complete, incomplete: total - complete, pending },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async addCompleteFallbacks(accounts: AccountRecord[], database: Prisma.TransactionClient = this.prisma) {
    const incomplete = accounts.filter((account) => !(account.athlete === null && account.media?.length)
      && (!accountProfileState(selectAccountProfileSource(account)).complete
      || (account.accountType !== SportDataAccountType.ATHLETE && !accountProfileState(selectAccountProfileSource({ ...account, athlete: null, media: [] })).complete)));
    if (!incomplete.length) return;
    const fallbacks = await database.participantAccount.findMany({
      where: { id: { in: incomplete.map((account) => account.id) } },
      select: { id: true, eventParticipations: {
        where: completeParticipationWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
        select: { identityType: true, documentEncrypted: true, media: { select: mediaSelect } },
      } },
    });
    for (const account of incomplete) {
      const fallback = fallbacks.find((item) => item.id === account.id)?.eventParticipations[0];
      if (fallback) account.eventParticipations.push(fallback);
    }
  }

  private serialize(account: AccountRecord) {
    const { athlete, eventParticipations, identityType, documentEncrypted, media, ...publicAccount } = account;
    const source = selectAccountProfileSource(account);
    const selectedTypes = accountProfileMediaTypes(source);
    let documentNumber: string | undefined;
    if (source?.documentEncrypted && source.identityType) {
      try {
        documentNumber = this.identity.decrypt(source.documentEncrypted, source.identityType);
      } catch {
        this.logger.warn(`Không thể đọc số giấy tờ của tài khoản ${account.id}`);
      }
    }
    return {
      ...publicAccount,
      profile: {
        ...accountProfileState(source), identityType: source?.identityType || null,
        ...(documentNumber ? { documentNumber } : {}),
        media: (source?.media || []).filter((media) => selectedTypes.includes(media.type) && usableAccountMedia(media)).map((media) => ({
          type: media.type, mimeType: media.mimeType, verificationStatus: media.verificationStatus,
          revision: createHash('sha256').update(media.storageKey!).digest('hex').slice(0, 16),
          mediaUrl: `/participant-auth/admin/accounts/${account.id}/media/${media.type}`,
        })),
      },
    };
  }

  async getMedia(accountId: string, type: AthleteMediaType, variant?: ImageVariant) {
    const account = await this.prisma.participantAccount.findUnique({ where: { id: accountId }, select: accountSelect });
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản SportData');
    await this.addCompleteFallbacks([account]);
    const source = selectAccountProfileSource(account);
    const media = source?.media.find((file) => file.type === type && usableAccountMedia(file));
    if (!media || !accountProfileMediaTypes(source).includes(type)) throw new NotFoundException('Chưa có tệp này trong hồ sơ tài khoản');
    return { data: await this.storage.read(media.storageKey!, media.mimeType.startsWith('image/') ? variant : undefined), mimeType: media.mimeType };
  }
}
