import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WinMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ParticipantResultDto {
  @IsString() matchParticipantId: string;
  @IsObject() @IsOptional() score?: Record<string, unknown>;
  @IsInt() @Min(1) @Type(() => Number) @IsOptional() rank?: number;
  @IsBoolean() @IsOptional() qualified?: boolean;
}

export class EnterResultDto {
  @ApiProperty({ description: 'Phiên bản kết quả mà màn hình đang hiển thị' })
  @IsInt() @Min(0) @Type(() => Number)
  expectedVersion: number;
  @ApiPropertyOptional() @IsNumber() @Type(() => Number) @IsOptional() athlete1Score?: number;
  @ApiPropertyOptional() @IsNumber() @Type(() => Number) @IsOptional() athlete2Score?: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @Type(() => Number) @IsOptional() athlete1Advantages?: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @Type(() => Number) @IsOptional() athlete2Advantages?: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @Type(() => Number) @IsOptional() athlete1Penalties?: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @Type(() => Number) @IsOptional() athlete2Penalties?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() winnerId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() winnerTeamId?: string;
  @ApiPropertyOptional({ enum: WinMethod }) @IsEnum(WinMethod) @IsOptional() winMethod?: WinMethod;
  @ApiPropertyOptional() @IsObject() @IsOptional() resultData?: Record<string, unknown>;
  @ApiPropertyOptional({ type: [ParticipantResultDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => ParticipantResultDto) @IsOptional()
  participantResults?: ParticipantResultDto[];
  @ApiPropertyOptional() @IsString() @IsOptional() reason?: string;
  @ApiPropertyOptional({ description: 'Mã bản xem trước cặp đấu dùng khi hiệu chỉnh kết quả' }) @IsString() @IsOptional() progressionToken?: string;
}

export class ResultActionDto {
  @ApiProperty({ description: 'Phiên bản kết quả mà màn hình đang hiển thị' })
  @IsInt() @Min(0) @Type(() => Number)
  expectedVersion: number;
  @ApiPropertyOptional() @IsString() @IsOptional() reason?: string;
}
