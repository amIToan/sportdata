import { EventParticipationRole } from '@prisma/client';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class AdminEventParticipationDto {
  @IsString()
  @MinLength(1)
  eventId: string;

  @IsString()
  @MinLength(1)
  accountId: string;

  @IsIn([EventParticipationRole.REFEREE, EventParticipationRole.COACH, EventParticipationRole.TEAM_LEADER])
  role: EventParticipationRole;

  @IsOptional()
  @IsString()
  @MinLength(1)
  federationId?: string;
}
