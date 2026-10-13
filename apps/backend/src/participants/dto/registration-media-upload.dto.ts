import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

class RegistrationMediaUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  token: string;
}

export class RegistrationMediaUploadsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationMediaUploadDto)
  avatar?: RegistrationMediaUploadDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationMediaUploadDto)
  cccdFront?: RegistrationMediaUploadDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationMediaUploadDto)
  cccdBack?: RegistrationMediaUploadDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationMediaUploadDto)
  passport?: RegistrationMediaUploadDto;
}
