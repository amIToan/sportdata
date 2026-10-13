import { EventParticipationRole, RegistrationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDefined, IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';

class ParticipationMediaUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  token: string;
}

class ParticipationMediaUploadsDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ParticipationMediaUploadDto)
  avatar: ParticipationMediaUploadDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParticipationMediaUploadDto)
  cccdFront?: ParticipationMediaUploadDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParticipationMediaUploadDto)
  cccdBack?: ParticipationMediaUploadDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParticipationMediaUploadDto)
  passport?: ParticipationMediaUploadDto;
}

export class CreateEventParticipationDto {
  @IsString()
  @MinLength(1)
  eventId: string;

  @IsIn([EventParticipationRole.REFEREE, EventParticipationRole.TEAM_LEADER, EventParticipationRole.COACH])
  role: EventParticipationRole;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @IsIn(['CCCD', 'PASSPORT'])
  identityType: 'CCCD' | 'PASSPORT';

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  documentNumber: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => ParticipationMediaUploadsDto)
  mediaUploads: ParticipationMediaUploadsDto;

  @ValidateIf((dto) => dto.role === EventParticipationRole.TEAM_LEADER || dto.federationId !== undefined)
  @IsString()
  @MinLength(1)
  federationId?: string;
}

export class UpdateEventParticipationStatusDto {
  @IsEnum(RegistrationStatus)
  status: RegistrationStatus;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason: string;
}
