import { DrawPreconfigureGuard } from '../auth/draw-preconfigure.guard';
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { MatchExportService } from './match-export.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicEventStreamService } from './public-event-stream.service';
import { PublicEventStreamInterceptor } from './public-event-stream.interceptor';

@Module({
  imports: [PrismaModule],
  controllers: [MatchesController],
  providers: [
    MatchesService,
    MatchExportService,
    DrawPreconfigureGuard,
    PublicEventStreamService,
    { provide: APP_INTERCEPTOR, useClass: PublicEventStreamInterceptor },
  ],
  exports: [MatchesService],
})
export class MatchesModule {}
