import { IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ScheduleConfig } from '../planner/schedule-config';

export class SaveScheduleDraftDto {
  @IsObject() config: ScheduleConfig;
  @IsInt() @Min(0) expectedDraftVersion: number;
  @IsString() @MaxLength(100) @IsOptional() idempotencyKey?: string;
}

export class PreviewScheduleDto {
  @IsObject() config: ScheduleConfig;
  @IsInt() @Min(0) expectedDraftVersion: number;
}

export class DeleteScheduleDraftDto {
  @IsInt() @Min(0) expectedDraftVersion: number;
}

export class ApplyScheduleDto {
  @IsString() previewId: string;
  @IsInt() @Min(0) draftVersion: number;
  @IsString() @IsOptional() expectedAppliedRevision?: string;
  @IsString() @MaxLength(100) idempotencyKey: string;
  @IsBoolean() acknowledgeWarnings: boolean;
}
