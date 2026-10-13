import { AthleteMediaType, DocumentVerificationStatus, SportDataAccountType } from '@prisma/client';

export type AccountProfileMedia = {
  type: AthleteMediaType;
  storageKey: string | null;
  mimeType: string;
  size: number;
  verificationStatus: DocumentVerificationStatus | null;
};

export type AccountProfileSource = {
  identityType: 'CCCD' | 'PASSPORT' | null;
  documentEncrypted: string | null;
  media: AccountProfileMedia[];
};

type ProfileAccount = {
  accountType: SportDataAccountType;
  identityType: string | null;
  documentEncrypted?: string | null;
  media?: AccountProfileMedia[];
  athlete: {
    identity: { cccdEncrypted: string | null; passportEncrypted: string | null } | null;
    media: AccountProfileMedia[];
  } | null;
  eventParticipations: {
    identityType: string | null;
    documentEncrypted: string | null;
    media: AccountProfileMedia[];
  }[];
};

export const accountImageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
export const accountDocumentMimeTypes = [...accountImageMimeTypes, 'application/pdf'];

export function usableAccountMedia(media: AccountProfileMedia): boolean {
  return Boolean(media.storageKey?.trim()) && Number.isFinite(media.size) && media.size > 0 && media.size <= 8 * 1024 * 1024
    && (media.type === AthleteMediaType.AVATAR ? accountImageMimeTypes : accountDocumentMimeTypes).includes(media.mimeType);
}

export function accountProfileState(source: AccountProfileSource | null) {
  const types = new Set(source?.media.filter(usableAccountMedia).map((media) => media.type) || []);
  const hasAvatar = types.has(AthleteMediaType.AVATAR);
  const hasIdentityDocuments = source?.identityType === 'CCCD'
    ? types.has(AthleteMediaType.CCCD_FRONT) && types.has(AthleteMediaType.CCCD_BACK)
    : source?.identityType === 'PASSPORT' && types.has(AthleteMediaType.PASSPORT);
  return { hasAvatar, hasIdentityDocuments, complete: hasAvatar && hasIdentityDocuments };
}

function participationSource(record: ProfileAccount['eventParticipations'][number]): AccountProfileSource {
  const types = new Set(record.media.filter(usableAccountMedia).map((media) => media.type));
  const knownIdentityType = record.identityType === 'CCCD' || record.identityType === 'PASSPORT' ? record.identityType : null;
  return {
    identityType: knownIdentityType || (types.has(AthleteMediaType.CCCD_FRONT) && types.has(AthleteMediaType.CCCD_BACK)
      ? 'CCCD' : types.has(AthleteMediaType.PASSPORT) ? 'PASSPORT' : null),
    documentEncrypted: knownIdentityType ? record.documentEncrypted : null,
    media: record.media,
  };
}

function athleteSource(account: ProfileAccount): AccountProfileSource | null {
  if (!account.athlete) return null;
  const identityTypes: Array<'CCCD' | 'PASSPORT'> = account.identityType === 'PASSPORT' ? ['PASSPORT', 'CCCD'] : ['CCCD', 'PASSPORT'];
  const sources = identityTypes.map((identityType): AccountProfileSource => ({
    identityType,
    documentEncrypted: identityType === 'CCCD' ? account.athlete!.identity?.cccdEncrypted || null : account.athlete!.identity?.passportEncrypted || null,
    media: account.athlete!.media,
  }));
  if (account.identityType === 'CCCD' || account.identityType === 'PASSPORT') return sources[0];
  return sources.find((source) => Boolean(source.documentEncrypted))
    || sources.find((source) => accountProfileState(source).complete)
    || sources.find((source) => source.media.some((media) => usableAccountMedia(media)
      && media.type === (source.identityType === 'CCCD' ? AthleteMediaType.CCCD_FRONT : AthleteMediaType.PASSPORT)))
    || { identityType: null, documentEncrypted: null, media: account.athlete.media };
}

export function accountProfileMediaTypes(source: AccountProfileSource | null): AthleteMediaType[] {
  return source?.identityType === 'CCCD'
    ? [AthleteMediaType.AVATAR, AthleteMediaType.CCCD_FRONT, AthleteMediaType.CCCD_BACK]
    : source?.identityType === 'PASSPORT' ? [AthleteMediaType.AVATAR, AthleteMediaType.PASSPORT] : [AthleteMediaType.AVATAR];
}

// Keep a document number and all of its files together; never fill gaps by combining registrations.
export function selectAccountProfileSource(account: ProfileAccount): AccountProfileSource | null {
  // Account uploads are the current profile until an athlete is linked. Incomplete
  // replacements must stay visible instead of falling back to older event files.
  if (!account.athlete && account.media?.length) {
    return {
      identityType: account.identityType === 'CCCD' || account.identityType === 'PASSPORT' ? account.identityType : null,
      documentEncrypted: account.documentEncrypted || null,
      media: account.media,
    };
  }
  const athlete = athleteSource(account);
  const participations = account.eventParticipations.map(participationSource);
  const candidates = account.accountType === SportDataAccountType.ATHLETE
    ? [athlete, ...participations] : [...participations, athlete];
  return candidates.find((source) => accountProfileState(source).complete) || candidates.find(Boolean) || null;
}
