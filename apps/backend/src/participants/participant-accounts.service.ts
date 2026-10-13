import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountVerificationStatus, AthleteMediaType, Prisma, SportDataAccountType } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AthleteIdentityService } from '../athletes/athlete-identity.service';
import type { ImageVariant } from '../storage/image-variant';
import { ListParticipantAccountsDto } from './dto/list-participant-accounts.dto';
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
  federation: { select: { id: true, name: true, country: { select: { code: true, name: true } } } },
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
