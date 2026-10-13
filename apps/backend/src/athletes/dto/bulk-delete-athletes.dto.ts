import { OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsString,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { QueryAthletesDto } from './query-athletes.dto';

export class AthleteDeleteFiltersDto extends OmitType(QueryAthletesDto, ['page', 'limit'] as const) {}

export class PreviewAthleteDeleteDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AthleteDeleteFiltersDto)
  filters: AthleteDeleteFiltersDto;
}

export enum AthleteDeleteMode {
  SELECTED = 'SELECTED',
  ALL_MATCHING = 'ALL_MATCHING',
}

export class BulkDeleteAthletesDto {
  @IsEnum(AthleteDeleteMode)
  mode: AthleteDeleteMode;

  @ValidateIf((dto) => dto.mode === AthleteDeleteMode.SELECTED || dto.ids !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @Matches(/^\S+$/, { each: true })
  ids?: string[];

  @ValidateIf((dto) => dto.mode === AthleteDeleteMode.ALL_MATCHING || dto.filters !== undefined)
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AthleteDeleteFiltersDto)
  filters?: AthleteDeleteFiltersDto;

  @ValidateIf((dto) => dto.mode === AthleteDeleteMode.ALL_MATCHING || dto.expectedCount !== undefined)
  @IsInt()
  @Min(1)
  expectedCount?: number;

  @ValidateIf((dto) => dto.mode === AthleteDeleteMode.ALL_MATCHING || dto.selectionToken !== undefined)
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  selectionToken?: string;
}
