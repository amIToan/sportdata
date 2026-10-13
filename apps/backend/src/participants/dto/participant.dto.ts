import { Type } from 'class-transformer';
import { PartialType, PickType } from '@nestjs/mapped-types';
import { CreateAthleteDto } from '../../athletes/dto/create-athlete.dto';
import { RegistrationMediaUploadsDto } from './registration-media-upload.dto';
import {
  IsDateString,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  ArrayUnique,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  IsIn,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AccountVerificationStatus,
  DocumentVerificationStatus,
  Gender,
  PaymentStatus,
  RegistrationStatus,
  SportDataAccountType,
} from '@prisma/client';

export class ParticipantRegisterDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1, { message: 'Mỗi tài khoản chỉ được chọn một loại' })
  @ArrayUnique()
  @IsEnum(SportDataAccountType, { each: true })
  accountTypes?: SportDataAccountType[];
  @IsIn(['CCCD', 'PASSPORT'])
  identityType: 'CCCD' | 'PASSPORT';

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  documentNumber: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(2)
  displayName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsDateString()
  birthDate: string;

  @IsString()
  countryId: string;

  @IsOptional()
  @IsString()
  federationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  weight?: number;
}

export class ParticipantLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsEnum(SportDataAccountType)
  accountType?: SportDataAccountType;
}

export class UpdateAccountTypesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1, { message: 'Mỗi tài khoản chỉ được chọn một loại' })
  @ArrayUnique()
  @IsEnum(SportDataAccountType, { each: true })
  accountTypes: SportDataAccountType[];
}

export class ParticipantForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ParticipantResetPasswordDto {
  @IsString()
  @MinLength(64)
  @MaxLength(128)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class UpdateParticipantProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  displayName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  countryId?: string;

  @IsOptional()
  @IsString()
  federationId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  weight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(300)
  height?: number;
}

export class CreatePublicRegistrationDto {
  @IsString()
  eventId: string;

  @IsString()
  categoryId: string;
}

export class AdminRegistrationAthleteDto extends PartialType(PickType(CreateAthleteDto, ['address'] as const)) {
  @IsIn(['CCCD', 'PASSPORT'])
  identityType: 'CCCD' | 'PASSPORT';

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  documentNumber: string;

  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  phone: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsDateString()
  birthDate: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  weight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  height?: number;

  @IsString()
  countryId: string;

  @IsOptional()
  @IsString()
  federationId?: string;
}

export class AdminCreateRegistrationDto {
  @IsString()
  eventId: string;

  @IsString()
  categoryId: string;

  @ValidateIf((value: AdminCreateRegistrationDto) => !value.athlete)
  @IsString()
  athleteId?: string;

  @ValidateIf((value: AdminCreateRegistrationDto) => !value.athleteId)
  @ValidateNested()
  @Type(() => AdminRegistrationAthleteDto)
  athlete?: AdminRegistrationAthleteDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationMediaUploadsDto)
  mediaUploads?: RegistrationMediaUploadsDto;

  @IsOptional()
  @IsIn([PaymentStatus.PENDING, PaymentStatus.PAID])
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentNote?: string;
}

export class UpdateRegistrationCategoryDto {
  @IsString()
  @MinLength(1)
  categoryId: string;
}

export class UpdateRegistrationStatusDto {
  @IsEnum(RegistrationStatus)
  status: RegistrationStatus;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class UpdateRegistrationPaymentStatusDto {
  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class UpdateDocumentVerificationDto {
  @IsEnum(DocumentVerificationStatus)
  status: DocumentVerificationStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ConfirmIdentityOcrDto {
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  sex?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  placeOfOrigin?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  placeOfBirth?: string;

  @IsOptional()
  @IsBoolean()
  applyToProfile?: boolean;
}

export class DownloadSubmissionTicketsDto {
  @IsEmail()
  contactEmail: string;
}

export class UpdateAccountVerificationDto {
  @IsEnum(AccountVerificationStatus)
  status: AccountVerificationStatus;
}
