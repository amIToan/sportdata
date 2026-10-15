import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { defaultCertificateDesign, validateCertificateDesign, type CertificateRecipient } from './certificate-design';
import { certificateAwards } from './certificate-awards';

@Injectable()
export class EventCertificatesService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  private async event(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id }, select: {
      id: true, certificateDesign: true, certificateBackgroundStorageKey: true,
      certificateBackgroundMimeType: true, updatedAt: true,
    } });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');
    return event;
  }

  async config(id: string) {
    const event = await this.event(id);
    return {
      design: event.certificateDesign || defaultCertificateDesign(),
      backgroundUrl: event.certificateBackgroundStorageKey ? `/api/events/${id}/certificates/background?v=${event.updatedAt.getTime()}` : null,
    };
  }

  async save(id: string, value: unknown) {
    await this.event(id);
    let design;
    try { design = validateCertificateDesign(value); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    await this.prisma.event.update({ where: { id }, data: { certificateDesign: design as unknown as Prisma.InputJsonValue } });
    return this.config(id);
  }

  async uploadBackground(id: string, file?: Express.Multer.File) {
    await this.event(id);
    if (!file || !file.buffer?.length || file.size > 20 * 1024 * 1024) throw new BadRequestException('Phôi tối đa 20 MB');
    // The browser rasterizes the selected PDF page before uploading. Only passive image data is served.
    const png = file.mimetype === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = file.mimetype === 'image/jpeg' && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
    if (!png && !jpeg) throw new BadRequestException('Phôi phải là ảnh PNG hoặc JPG hợp lệ');
    const stored = await this.storage.upload(file.buffer, file.mimetype, `events/${id}/certificates`);
    let previous: string | null;
    try {
      previous = await this.prisma.$transaction(async (tx) => {
        const current = await tx.event.findUniqueOrThrow({ where: { id }, select: { certificateBackgroundStorageKey: true } });
        await tx.event.update({ where: { id }, data: { certificateBackgroundStorageKey: stored.key, certificateBackgroundMimeType: stored.mimeType } });
        return current.certificateBackgroundStorageKey;
      });
    } catch (error) { await this.storage.deleteQuietly(stored.key); throw error; }
    if (previous) await this.storage.deleteQuietly(previous);
    return this.config(id);
  }

  async removeBackground(id: string) {
    const event = await this.event(id);
    await this.prisma.event.update({ where: { id }, data: { certificateBackgroundStorageKey: null, certificateBackgroundMimeType: null } });
    if (event.certificateBackgroundStorageKey) await this.storage.deleteQuietly(event.certificateBackgroundStorageKey);
    return this.config(id);
  }

  async background(id: string) {
    const event = await this.event(id);
    if (!event.certificateBackgroundStorageKey) throw new NotFoundException('Chưa có phôi chứng nhận');
    return { data: await this.storage.read(event.certificateBackgroundStorageKey), mimeType: event.certificateBackgroundMimeType || 'image/png' };
  }

  async recipients(id: string): Promise<CertificateRecipient[]> {
    const event = await this.prisma.event.findUnique({ where: { id }, select: {
      categories: { select: { id: true } },
      athletes: { select: { id: true, fullName: true, birthDate: true, country: { select: { name: true } }, federation: { select: { name: true } }, categories: { include: { sport: { select: { name: true } } } } } },
    } });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện');
    const registrations = await this.prisma.eventRegistration.findMany({ where: { eventId: id, status: 'CONFIRMED' }, select: {
      athlete: { select: { id: true, fullName: true, birthDate: true, country: { select: { name: true } }, federation: { select: { name: true } } } },
      federation: { select: { name: true } }, category: { include: { sport: { select: { name: true } } } },
    } });
    const items = new Map<string, CertificateRecipient>();
    const categoryIds = new Set(event.categories.map((category) => category.id));
    const add = (athlete: { id: string; fullName: string; birthDate: Date | null; country: { name: string } | null; federation: { name: string } | null }, category?: { id: string; name: string; sport: { name: string } }, federation?: string) => {
      const key = `${athlete.id}:${category?.id || 'participation'}`;
      items.set(key, { id: key, athleteName: athlete.fullName, birthDate: athlete.birthDate?.toISOString() || null,
        federation: federation || athlete.federation?.name || '', country: athlete.country?.name || '', category: category?.name || '', sport: category?.sport.name || '' });
    };
    // Legacy events keep their participant list directly on the event.
    for (const athlete of event.athletes) {
      const categories = athlete.categories.filter((category) => categoryIds.has(category.id));
      if (categories.length) categories.forEach((category) => add(athlete, category));
      else add(athlete);
    }
    for (const registration of registrations) {
      items.delete(`${registration.athlete.id}:participation`);
      add(registration.athlete, registration.category, registration.federation?.name);
    }
    const team = { select: { id: true, members: { select: { athleteId: true } } } } as const;
    const draws = await this.prisma.draw.findMany({ where: { eventId: id }, select: {
      eventId: true, categoryId: true, divisionId: true, type: true, matches: { select: {
        id: true, status: true, resultStatus: true, matchType: true, athlete1Id: true, athlete2Id: true,
        winnerId: true, winnerTeamId: true, winnerToMatchId: true, loserToMatchId: true, team1: team, team2: team,
      } },
    } });
    const awards = certificateAwards(draws);
    return [...items.values()].map((item) => ({ ...item, award: awards.get(item.id) || '' })).sort((a, b) => a.athleteName.localeCompare(b.athleteName, 'vi') || a.category.localeCompare(b.category, 'vi'));
  }
}
