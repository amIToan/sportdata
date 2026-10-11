import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { PublicEventStreamService } from './public-event-stream.service';

@Injectable()
export class PublicEventStreamInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PublicEventStreamInterceptor.name);

  constructor(
    private readonly streams: PublicEventStreamService,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return next.handle();

    const path = request.path;
    const matchWrite = /^\/api\/matches(?:\/[^/]+)?$/.test(path);
    const drawWrite = /^\/api\/matches\/event\/[^/]+\/(?:distribute-dates|category\/[^/]+\/(?:generate-draw|revert-draw))$/.test(path);
    const resultWrite = /^\/api\/results\/matches\/[^/]+\/(?:enter|referee-confirm|approve|publish|lock|reopen)$/.test(path);
    const scoreboardWrite = /^\/api\/results\/matches\/[^/]+\/scoreboard$/.test(path)
      && ['START', 'FINISH'].includes(request.body?.action);
    const planApply = /^\/api\/scheduling\/events\/[^/]+\/plans\/[^/]+\/apply$/.test(path);
    const scheduleWrite = /^\/api\/scheduling\/events\/[^/]+\/auto-schedule$/.test(path);
    if (!matchWrite && !drawWrite && !resultWrite && !scoreboardWrite && !scheduleWrite && !planApply) return next.handle();

    // Moving a match must also refresh its old event. This is a normal read;
    // notifications need no schema changes, triggers or extra DB connections.
    let previousEventId: string | undefined;
    if (matchWrite && request.method === 'PATCH' && request.params.id && request.body?.eventId) {
      try {
        const previous = await this.prisma.match.findUnique({
          where: { id: String(request.params.id) }, select: { eventId: true },
        });
        previousEventId = previous?.eventId;
      } catch (error) {
        this.logger.warn(error instanceof Error ? error.message : String(error));
      }
    }

    // Controllers resolve after their services finish saving/committing. tap
    // runs only on a successful response, never on an exception/rollback.
    return next.handle().pipe(tap((result: { eventId?: string; dryRun?: boolean } | undefined) => {
      if (scheduleWrite && result?.dryRun !== false) return;
      const eventIds = new Set([previousEventId, result?.eventId, request.params.eventId, request.body?.eventId]);
      for (const eventId of eventIds) {
        if (typeof eventId === 'string' && eventId) this.streams.notifyScheduleChanged(eventId);
      }
    }));
  }
}
