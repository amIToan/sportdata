import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AccountVerificationStatus, SportDataAccountType } from '@prisma/client';

export class ListParticipantAccountsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  search?: string;

  @IsOptional()
  @IsEnum(SportDataAccountType)
  accountType?: SportDataAccountType;

  @IsOptional()
  @IsIn(['PERSONNEL'])
  accountGroup?: 'PERSONNEL';

  @IsOptional()
  @IsEnum(AccountVerificationStatus)
  verificationStatus?: AccountVerificationStatus;

  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  federationId?: string;

  @IsOptional()
  @IsIn(['COMPLETE', 'INCOMPLETE'])
  profileStatus?: 'COMPLETE' | 'INCOMPLETE';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsIn(['createdAt', 'displayName'])
  sortBy: 'createdAt' | 'displayName' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
