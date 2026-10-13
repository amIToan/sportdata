import { AthleteMediaType, DocumentVerificationStatus } from '@prisma/client';
import { usableAccountMedia, type AccountProfileMedia } from './participant-account-profile';

export const registrationMediaSelect = {
  type: true, storageKey: true, mimeType: true, size: true, verificationStatus: true,
} as const;

export function registrationMediaState(media: AccountProfileMedia[], identityType?: string | null) {
  const byType = new Map(media.filter(usableAccountMedia).map((item) => [item.type, item]));
  const hasAvatar = byType.has(AthleteMediaType.AVATAR);
  const hasCccd = byType.has(AthleteMediaType.CCCD_FRONT) && byType.has(AthleteMediaType.CCCD_BACK);
  const hasPassport = byType.has(AthleteMediaType.PASSPORT);
  const cccdVerified = hasCccd && byType.get(AthleteMediaType.CCCD_FRONT)?.verificationStatus === DocumentVerificationStatus.VERIFIED
    && byType.get(AthleteMediaType.CCCD_BACK)?.verificationStatus === DocumentVerificationStatus.VERIFIED;
  const passportVerified = hasPassport && byType.get(AthleteMediaType.PASSPORT)?.verificationStatus === DocumentVerificationStatus.VERIFIED;
  const hasIdentityDocuments = identityType === 'CCCD' ? hasCccd : identityType === 'PASSPORT' ? hasPassport : hasCccd || hasPassport;
  const verified = identityType === 'CCCD' ? cccdVerified : identityType === 'PASSPORT' ? passportVerified : cccdVerified || passportVerified;
  return { hasAvatar, hasIdentityDocuments, complete: hasAvatar && hasIdentityDocuments, verified };
}
