import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ParticipantsController } from './participants.controller';
import { ParticipantAuthGuard } from './participant-auth.guard';
import { ParticipantsService } from './participants.service';
import { IdentityOcrService } from './identity-ocr.service';
import { TicketPdfService } from './ticket-pdf.service';
import { TicketEmailService } from './ticket-email.service';
import { TicketEmailQueueService } from './ticket-email-queue.service';
import { TicketEmailWorkerService } from './ticket-email-worker.service';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AthletesModule } from '../athletes/athletes.module';
import { EventParticipationsController } from './event-participations.controller';
import { EventParticipationsService } from './event-participations.service';
import { OptionalParticipantAuthGuard } from './optional-participant-auth.guard';
import { ParticipantAccountsController } from './participant-accounts.controller';
import { ParticipantAccountsService } from './participant-accounts.service';

@Module({
  imports: [AuthModule, SystemSettingsModule, NotificationsModule, AthletesModule],
  controllers: [ParticipantsController, EventParticipationsController, ParticipantAccountsController],
  providers: [ParticipantsService, ParticipantAuthGuard, OptionalParticipantAuthGuard, EventParticipationsService, ParticipantAccountsService, IdentityOcrService, TicketPdfService, TicketEmailService, TicketEmailQueueService, TicketEmailWorkerService],
  exports: [ParticipantsService],
})
export class ParticipantsModule {}
