import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EventCertificatesController } from './event-certificates.controller';
import { EventCertificatesService } from './event-certificates.service';

@Module({
  imports: [PrismaModule],
  controllers: [EventCertificatesController, EventsController],
  providers: [EventsService, EventCertificatesService],
  exports: [EventsService],
})
export class EventsModule {}
