import type { ImageVariant } from '../storage/image-variant';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AthleteMediaType, DocumentOcrStatus, DocumentVerificationStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateAthleteDto } from './dto/create-athlete.dto';
import { UpdateAthleteDto } from './dto/update-athlete.dto';
import { QueryAthletesDto } from './dto/query-athletes.dto';
import { AthleteDeleteMode, BulkDeleteAthletesDto, PreviewAthleteDeleteDto } from './dto/bulk-delete-athletes.dto';
import { AthleteIdentityService } from './athlete-identity.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';

type AthleteDeleteCandidate = { id: string; fullName?: string; updatedAt?: Date };
type AthleteDeleteFailure = { id: string; fullName?: string; reason: string };

@Injectable()
export class AthletesService {
  private readonly logger = new Logger(AthletesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly athleteIdentity: AthleteIdentityService,
    private readonly storage: StorageService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  async create(createAthleteDto: CreateAthleteDto) {
    const { eventIds, categoryIds, birthDate, identityType, documentNumber, address, ...data } = createAthleteDto;
    await this.validateAffiliation(data.countryId, data.federationId);

    return this.prisma.$transaction(async (transaction) => {
      await this.athleteIdentity.lock(transaction);
      const identity = await this.athleteIdentity.assertNew(transaction, {
        ...data, birthDate: birthDate ? new Date(birthDate) : undefined, identityType, documentNumber, address,
      });
      return transaction.athlete.create({
      data: {
        ...data,
        identity: { create: identity },
        email: data.email?.trim().toLowerCase(),
        phone: data.phone?.trim(),
        birthDate: birthDate ? new Date(birthDate) : undefined,
        events: eventIds
          ? { connect: eventIds.map((id) => ({ id })) }
          : undefined,
        categories: categoryIds
          ? { connect: categoryIds.map((id) => ({ id })) }
          : undefined,
      },
      include: this.getAthleteInclude(),
      });
    });
  }

  async findAll(query: QueryAthletesDto) {
    const { page = 1, limit = 30 } = query;
    const where = this.buildAthleteWhere(query);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.athlete.findMany({
        where,
        include: this.getAthleteListInclude(),
        skip,
        take: limit,
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.athlete.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private buildAthleteWhere(query: QueryAthletesDto): Prisma.AthleteWhereInput {
    const {
      search,
      countryId,
      federationId,
      federationIds,
      includeIndependent,
      sportId,
      categoryId,
      categoryIds,
      gender,
      eventId,
    } = query;

    const where: Prisma.AthleteWhereInput = {};

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (countryId) {
      where.countryId = countryId;
    }

    const selectedFederationIds = [
      ...(federationIds || '').split(','),
      ...(federationId ? [federationId] : []),
    ].map((id) => id.trim()).filter(Boolean);
    if (selectedFederationIds.length) {
      if (includeIndependent) {
        where.AND = [{
          OR: [
            { federationId: { in: [...new Set(selectedFederationIds)] } },
            { federationId: null },
          ],
        }];
      } else {
        where.federationId = { in: [...new Set(selectedFederationIds)] };
      }
    }

    if (gender) {
      where.gender = gender;
    }

    const selectedCategoryIds = [
      ...(categoryIds || '').split(','),
      ...(categoryId ? [categoryId] : []),
    ].map((id) => id.trim()).filter(Boolean);
    if (sportId || selectedCategoryIds.length) {
      where.categories = {
        some: {
          ...(sportId ? { sportId } : {}),
          ...(selectedCategoryIds.length ? { id: { in: selectedCategoryIds } } : {}),
        },
      };
    }

    if (eventId) {
      where.events = {
        some: {
          id: eventId,
        },
      };
    }

    return where;
  }

  async getFilterOptions(query: QueryAthletesDto) {
    const selectedCategoryIds = [
      ...(query.categoryIds || '').split(','),
      ...(query.categoryId ? [query.categoryId] : []),
    ].map((id) => id.trim()).filter(Boolean);
    const selectedFederationIds = [
      ...(query.federationIds || '').split(','),
      ...(query.federationId ? [query.federationId] : []),
    ].map((id) => id.trim()).filter(Boolean);
    const where: any = {
      ...(query.eventId ? { events: { some: { id: query.eventId } } } : {}),
      ...(query.gender ? { gender: query.gender } : {}),
      ...(selectedFederationIds.length && !query.includeIndependent
        ? { federationId: { in: [...new Set(selectedFederationIds)] } }
        : {}),
      ...(selectedFederationIds.length && query.includeIndependent
        ? {
            AND: [{
              OR: [
                { federationId: { in: [...new Set(selectedFederationIds)] } },
                { federationId: null },
              ],
            }],
          }
        : {}),
      ...(query.sportId || selectedCategoryIds.length
        ? {
            categories: {
              some: {
                ...(query.sportId ? { sportId: query.sportId } : {}),
                ...(selectedCategoryIds.length ? { id: { in: selectedCategoryIds } } : {}),
              },
            },
          }
        : {}),
    };

    const [countryGroups, federationGroups] = await Promise.all([
      this.prisma.athlete.groupBy({
        by: ['countryId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.athlete.groupBy({
        by: ['federationId'],
        where,
        _count: { _all: true },
      }),
    ]);
    const federationGroupIds = federationGroups
      .map((group) => group.federationId)
      .filter((id): id is string => Boolean(id));
    const [countries, federations] = await Promise.all([
      this.prisma.country.findMany({
        where: { id: { in: countryGroups.map((group) => group.countryId) } },
        select: { id: true, code: true, name: true, flagUrl: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.federation.findMany({
        where: { id: { in: federationGroupIds } },
        select: { id: true, code: true, name: true, type: true, countryId: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const countByCountry = new Map(
      countryGroups.map((group) => [group.countryId, group._count._all]),
    );
    const countByFederation = new Map(
      federationGroups.map((group) => [group.federationId, group._count._all]),
    );

    return {
      countries: countries.map((country) => ({
        ...country,
        athleteCount: countByCountry.get(country.id) || 0,
      })),
      federations: federations.map((federation) => ({
        ...federation,
        athleteCount: countByFederation.get(federation.id) || 0,
      })),
      total: countryGroups.reduce((sum, group) => sum + group._count._all, 0),
    };
  }

  async findOne(id: string) {
    const athlete = await this.prisma.athlete.findUnique({
      where: { id },
      include: {
        ...this.getAthleteInclude(),
        statistics: {
          include: {
            sport: true,
            event: {
              select: {
                id: true,
                name: true,
                startDate: true,
                endDate: true,
                location: true,
              },
            },
          },
        },
      },
    });

    if (!athlete) {
      throw new NotFoundException(`Không tìm thấy vận động viên có mã ${id}`);
    }

    return athlete;
  }

  async update(id: string, updateAthleteDto: UpdateAthleteDto) {
    const { eventIds, categoryIds, birthDate, identityType, documentNumber, address, ...data } = updateAthleteDto;

    const existingAthlete = await this.findOne(id);
    await this.validateAffiliation(
      data.countryId || existingAthlete.countryId,
      data.federationId === undefined
        ? existingAthlete.federationId || undefined
        : data.federationId || undefined,
    );

    return this.prisma.$transaction(async (transaction) => {
      await this.athleteIdentity.lock(transaction);
      const identity = await this.athleteIdentity.assertNew(transaction, {
        ...existingAthlete, ...data, birthDate: birthDate ? new Date(birthDate) : existingAthlete.birthDate,
        identityType, documentNumber, address,
      }, id);
      return transaction.athlete.update({
      where: { id },
      data: {
        ...data,
        ...((documentNumber || address) ? { identity: { upsert: {
          create: identity,
          update: {
            ...(documentNumber ? { documentHash: identity.documentHash, cccdHash: identity.cccdHash, cccdEncrypted: identity.cccdEncrypted,
              passportHash: identity.passportHash, passportEncrypted: identity.passportEncrypted } : {}),
            ...(address ? { addressHash: identity.addressHash } : {}),
          },
        } } } : {}),
        email: data.email === null ? null : data.email?.trim().toLowerCase(),
        phone: data.phone === null ? null : data.phone?.trim(),
        birthDate: birthDate ? new Date(birthDate) : undefined,
        events: eventIds
          ? { set: eventIds.map((eId) => ({ id: eId })) }
          : undefined,
        categories: categoryIds
          ? { set: categoryIds.map((cId) => ({ id: cId })) }
          : undefined,
      },
      include: this.getAthleteInclude(),
      });
    });
  }

  async remove(id: string) {
    return this.deleteAthlete(id);
  }

  async previewBulkDelete(dto: PreviewAthleteDeleteDto) {
    if (!dto.filters || typeof dto.filters !== 'object' || Array.isArray(dto.filters)) {
      throw new BadRequestException('Vui lòng cung cấp bộ lọc danh sách cần xóa');
    }
    const where = this.buildAthleteWhere(dto.filters);
    const candidates = await this.findDeleteCandidates(where);
    return { total: candidates.length, selectionToken: this.deleteSelectionToken(where, candidates) };
  }

  async bulkDelete(dto: BulkDeleteAthletesDto) {
    let where: Prisma.AthleteWhereInput;
    let candidates: AthleteDeleteCandidate[];
    if (dto.mode === AthleteDeleteMode.SELECTED) {
      if (!Array.isArray(dto.ids) || !dto.ids.length || dto.ids.length > 1000
        || dto.ids.some((id) => typeof id !== 'string' || !/^\S+$/.test(id))
        || dto.filters !== undefined || dto.expectedCount !== undefined || dto.selectionToken !== undefined) {
        throw new BadRequestException('Chọn từ 1 đến 1000 vận động viên cần xóa');
      }
      const ids = [...new Set(dto.ids)];
      where = { id: { in: ids } };
      const existing = new Map((await this.findDeleteCandidates(where)).map((athlete) => [athlete.id, athlete]));
      candidates = ids.map((id) => existing.get(id) || { id });
    } else if (dto.mode === AthleteDeleteMode.ALL_MATCHING) {
      if (!dto.filters || typeof dto.filters !== 'object' || Array.isArray(dto.filters)
        || !Number.isSafeInteger(dto.expectedCount) || dto.expectedCount < 1
        || !/^[a-f0-9]{64}$/.test(dto.selectionToken || '') || dto.ids !== undefined) {
        throw new BadRequestException('Vui lòng chọn lại và xác nhận toàn bộ danh sách cần xóa');
      }
      where = this.buildAthleteWhere(dto.filters);
      candidates = await this.findDeleteCandidates(where);
      if (candidates.length !== dto.expectedCount || this.deleteSelectionToken(where, candidates) !== dto.selectionToken) {
        throw new ConflictException('Danh sách vận động viên đã thay đổi. Vui lòng tải lại, chọn và xác nhận xóa lần nữa.');
      }
    } else {
      throw new BadRequestException('Phạm vi xóa vận động viên không hợp lệ');
    }

    const outcomes: ({ deleted: { id: string; fullName: string } } | { failed: AthleteDeleteFailure })[] = [];
    let nextIndex = 0;
    // Each athlete has its own transaction so a protected record never hides
    // successful deletions or aborts PostgreSQL transactions for other records.
    await Promise.all(Array.from({ length: Math.min(5, candidates.length) }, async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex++;
        const candidate = candidates[index];
        try {
          const deleted = await this.deleteAthlete(candidate.id, {
            AND: [where, ...(candidate.updatedAt ? [{ updatedAt: candidate.updatedAt }] : [])],
          });
          outcomes[index] = { deleted: { id: deleted.id, fullName: deleted.fullName } };
        } catch (error) {
          outcomes[index] = { failed: { id: candidate.id, fullName: candidate.fullName, reason: this.deleteFailureReason(error) } };
        }
      }
    }));

    const deleted = outcomes.flatMap((outcome) => 'deleted' in outcome ? [outcome.deleted] : []);
    const failed = outcomes.flatMap((outcome) => 'failed' in outcome ? [outcome.failed] : []);
    return {
      requestedCount: candidates.length,
      deletedCount: deleted.length,
      deletedIds: deleted.map((athlete) => athlete.id),
      deleted,
      failed,
    };
  }

  private findDeleteCandidates(where: Prisma.AthleteWhereInput) {
    return this.prisma.athlete.findMany({
      where,
      select: { id: true, fullName: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
  }

  private deleteSelectionToken(where: Prisma.AthleteWhereInput, candidates: AthleteDeleteCandidate[]) {
    return createHash('sha256').update(JSON.stringify({
      where,
      athletes: candidates.map((athlete) => [athlete.id, athlete.updatedAt?.toISOString()]),
    })).digest('hex');
  }

  private async deleteAthlete(id: string, additionalWhere?: Prisma.AthleteWhereInput) {
    const { result, media } = await this.prisma.$transaction(async (transaction) => {
      // Lock before collecting media keys; concurrent uploads must finish first
      // or fail after deletion, preventing orphaned private document files.
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM "Athlete" WHERE id = ${id} FOR UPDATE`);
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM "AthleteMedia" WHERE "athleteId" = ${id} FOR UPDATE`);
      const athlete = await transaction.athlete.findUnique({
        where: { id },
        select: { _count: { select: { statistics: true, teamMemberships: true } } },
      });
      if (!athlete) throw new NotFoundException('Vận động viên không còn trong danh sách');
      if (athlete._count.statistics || athlete._count.teamMemberships) {
        throw new BadRequestException('Không thể xóa vận động viên đang có thành tích hoặc thuộc đội thi đấu.');
      }
      const media = await transaction.athleteMedia.findMany({ where: { athleteId: id }, select: { storageKey: true } });
      // Preserve the same database cascade rules as individual deletion. The
      // linked SportData account remains; its athlete relation becomes empty.
      const result = await transaction.athlete.delete({
        where: { id, ...(additionalWhere ? { AND: [additionalWhere] } : {}) },
        include: this.getAthleteInclude(),
      });
      return { result, media };
    }, { timeout: 10000 });
    await Promise.all(media.map((file) => this.storage.deleteQuietly(file.storageKey)));
    return result;
  }

  private deleteFailureReason(error: unknown) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) return error.message;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') return 'Vận động viên đang được dữ liệu thi đấu hoặc thành tích sử dụng nên không thể xóa.';
      if (error.code === 'P2025') return 'Hồ sơ đã thay đổi hoặc không còn thuộc danh sách đã chọn. Vui lòng chọn lại.';
    }
    this.logger.error('Không thể hoàn tất xóa một hồ sơ vận động viên');
    return 'Không thể xóa hồ sơ này. Vui lòng thử lại.';
  }

  async uploadAvatar(id: string, file?: Express.Multer.File) {
    await this.findOne(id);
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh đại diện');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException('Ảnh đại diện phải là JPG, PNG hoặc WebP');
    }
    if (file.size > 8 * 1024 * 1024) throw new BadRequestException('Ảnh không được vượt quá 8 MB');
    this.validateDocumentFile(file, 8 * 1024 * 1024);
    const previous = await this.prisma.athleteMedia.findUnique({ where: { athleteId_type: { athleteId: id, type: AthleteMediaType.AVATAR } }, select: { storageKey: true } });
    await this.storage.withUpload(file, 'athletes/avatars', previous?.storageKey, (storageKey, stored) => this.prisma.$transaction([
      this.prisma.athleteMedia.upsert({
        where: { athleteId_type: { athleteId: id, type: AthleteMediaType.AVATAR } },
        create: { athleteId: id, type: AthleteMediaType.AVATAR, storageKey, mimeType: file.mimetype, size: stored.size },
        update: { storageKey, mimeType: file.mimetype, size: stored.size },
      }),
      this.prisma.athlete.update({
        where: { id },
        data: { photoUrl: `/api/participant-auth/avatar/${id}` },
      }),
    ]));
    return { photoUrl: `/api/participant-auth/avatar/${id}` };
  }

  async getDocuments(id: string) {
    await this.findOne(id);
    return this.prisma.athleteMedia.findMany({
      where: {
        athleteId: id,
        type: { in: this.documentTypes() },
      },
      select: {
        id: true,
        type: true,
        mimeType: true,
        size: true,
        verificationStatus: true,
        verificationNote: true,
        verifiedAt: true,
        updatedAt: true,
      },
      orderBy: { type: 'asc' },
    });
  }

  async getIdentityDetails(id: string) {
    const athlete = await this.prisma.athlete.findUnique({
      where: { id },
      select: { identity: true, media: {
        where: { type: { in: this.documentTypes() } },
        select: { type: true, ocrData: true },
      } },
    });
    if (!athlete) throw new NotFoundException('Không tìm thấy vận động viên');
    const legacyNumber = (type: AthleteMediaType) => {
      const media = athlete.media.find((item) => item.type === type);
      const data = media?.ocrData as { confirmedFields?: { documentNumber?: string }; fields?: { documentNumber?: string } } | null;
      return data?.confirmedFields?.documentNumber || data?.fields?.documentNumber || null;
    };
    return {
      cccd: athlete.identity?.cccdEncrypted ? this.athleteIdentity.decrypt(athlete.identity.cccdEncrypted, 'CCCD') : legacyNumber(AthleteMediaType.CCCD_FRONT),
      passport: athlete.identity?.passportEncrypted ? this.athleteIdentity.decrypt(athlete.identity.passportEncrypted, 'PASSPORT') : legacyNumber(AthleteMediaType.PASSPORT),
    };
  }

  async getDocument(id: string, type: AthleteMediaType, variant?: ImageVariant) {
    this.validateDocumentType(type);
    const document = await this.prisma.athleteMedia.findUnique({
      where: { athleteId_type: { athleteId: id, type } },
    });
    if (!document) throw new NotFoundException('Chưa có giấy tờ này');
    return { ...document, data: await this.storage.read(document.storageKey, variant) };
  }

  async uploadDocument(id: string, type: AthleteMediaType, file?: Express.Multer.File) {
    await this.findOne(id);
    this.validateDocumentType(type);
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh giấy tờ');
    this.validateDocumentFile(file);
    const settings = await this.systemSettings.get();
    const autoVerify = !settings.values.identityOcrEnabled;
    const verification = {
      verificationStatus: autoVerify ? DocumentVerificationStatus.VERIFIED : DocumentVerificationStatus.PENDING,
      verificationNote: autoVerify ? 'Tự động duyệt vì OCR CCCD / Hộ chiếu đang tắt.' : null,
      verifiedAt: autoVerify ? new Date() : null,
      verifiedBy: autoVerify ? 'SYSTEM:OCR_DISABLED' : null,
    };
    const previous = await this.prisma.athleteMedia.findUnique({ where: { athleteId_type: { athleteId: id, type } }, select: { storageKey: true } });
    return this.storage.withUpload(file, 'athletes/documents', previous?.storageKey, (storageKey, stored) => this.prisma.athleteMedia.upsert({
      where: { athleteId_type: { athleteId: id, type } },
      create: {
        athleteId: id,
        type,
        storageKey,
        mimeType: file.mimetype,
        size: stored.size,
        ...verification,
      },
      update: {
        storageKey,
        mimeType: file.mimetype,
        size: stored.size,
        ...verification,
        ocrStatus: DocumentOcrStatus.NOT_REQUESTED,
        ocrProvider: null,
        ocrConfidence: null,
        ocrData: Prisma.DbNull,
      },
      select: {
        id: true,
        type: true,
        mimeType: true,
        size: true,
        verificationStatus: true,
        verificationNote: true,
        verifiedAt: true,
        updatedAt: true,
      },
    }));
  }

  async deleteDocument(id: string, type: AthleteMediaType) {
    this.validateDocumentType(type);
    const previous = await this.prisma.athleteMedia.findUnique({ where: { athleteId_type: { athleteId: id, type } }, select: { storageKey: true } });
    const deleted = await this.prisma.athleteMedia.deleteMany({
      where: { athleteId: id, type },
    });
    if (!deleted.count) throw new NotFoundException('Chưa có giấy tờ này');
    await this.storage.deleteQuietly(previous?.storageKey);
    return { success: true };
  }

  private documentTypes(): AthleteMediaType[] {
    return [
      AthleteMediaType.CCCD_FRONT,
      AthleteMediaType.CCCD_BACK,
      AthleteMediaType.PASSPORT,
    ];
  }

  private validateDocumentType(type: AthleteMediaType) {
    if (!this.documentTypes().includes(type)) {
      throw new BadRequestException('Loại giấy tờ không hợp lệ');
    }
  }

  private validateDocumentFile(file: Express.Multer.File, maxBytes = 4 * 1024 * 1024) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Chỉ hỗ trợ JPG, PNG, WebP hoặc PDF');
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maxBytes) {
      throw new BadRequestException(`Tệp phải có dung lượng hợp lệ và không được vượt quá ${maxBytes / (1024 * 1024)} MB`);
    }

    const bytes = file.buffer;
    const valid = file.mimetype === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : file.mimetype === 'image/png'
        ? bytes.length >= 8
          && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : file.mimetype === 'image/webp'
          ? bytes.length >= 12
            && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
            && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          : bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    if (!valid) throw new BadRequestException('Nội dung tệp không đúng định dạng đã khai báo');
  }

  private getAthleteInclude() {
    return {
      country: true,
      federation: {
        include: {
          country: true,
        },
      },
      events: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          location: true,
        },
      },
      categories: {
        include: {
          sport: true,
        },
      },
      statistics: {
        include: {
          sport: true,
          event: {
            select: {
              id: true,
              name: true,
              startDate: true,
              endDate: true,
              location: true,
            },
          },
        },
      },
    };
  }

  private getAthleteListInclude() {
    return {
      country: true,
      federation: {
        include: { country: true },
      },
      categories: {
        include: { sport: true },
      },
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
    };
  }

  private async validateAffiliation(countryId: string, federationId?: string) {
    if (!federationId) return;
    const federation = await this.prisma.federation.findUnique({
      where: { id: federationId },
      select: { countryId: true, name: true },
    });
    if (!federation) {
      throw new BadRequestException('Đơn vị chủ quản không tồn tại');
    }
    if (federation.countryId !== countryId) {
      throw new BadRequestException(
        `Vận động viên và đơn vị “${federation.name}” phải cùng quốc gia`,
      );
    }
  }
}
