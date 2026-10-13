import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { WinMethod } from '@prisma/client';

export const SCOREBOARD_AWARDS = ['POINTS', 'ADVANTAGE', 'PENALTY', 'SUBMISSION'];

export class ScoreboardCommandDto {
  @IsString() @Length(20, 100) clientId: string;
  @IsInt() @Min(0) expectedVersion: number;
  @IsIn(['START', 'RESUME', 'PAUSE', 'AWARD', 'UNDO', 'FINISH', 'REVIEW_REQUEST', 'REVIEW_RESOLVE', 'REVIEW_UNDO', 'STALL_START', 'STALL_CANCEL', 'MEDICAL_START', 'MEDICAL_STOP', 'MEDICAL_DECISION', 'MEDICAL_UNDO']) action: string;
  @IsInt() @Min(1) @Max(2) @IsOptional() side?: number;
  @IsIn(SCOREBOARD_AWARDS) @IsOptional() award?: string;
  @IsInt() @Min(1) @Max(4) @IsOptional() points?: number;
  @IsInt() @Min(1) @Max(4) @IsOptional() penaltyLevel?: number;
  @IsString() @IsOptional() winnerId?: string;
  @IsEnum(WinMethod) @IsOptional() winMethod?: WinMethod;
  @IsIn(['ACCEPTED', 'REJECTED']) @IsOptional() reviewResult?: string;
  @IsIn(['FIT', 'UNFIT']) @IsOptional() medicalResult?: string;
}
