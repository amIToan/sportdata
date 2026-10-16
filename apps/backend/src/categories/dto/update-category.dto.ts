import { IsIn, IsString, IsOptional, IsNumber, IsEnum, IsArray, IsInt, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  BeltLevel,
  CompetitionFormat,
  Gender,
  JiuJitsuDiscipline,
  UniformType,
} from '@prisma/client';

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sportId?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ enum: JiuJitsuDiscipline })
  @IsOptional()
  @IsEnum(JiuJitsuDiscipline)
  discipline?: JiuJitsuDiscipline;

  @ApiPropertyOptional({ enum: UniformType })
  @IsOptional()
  @IsEnum(UniformType)
  uniform?: UniformType;

  @ApiPropertyOptional({ enum: BeltLevel })
  @IsOptional()
  @IsEnum(BeltLevel)
  beltLevel?: BeltLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  matchDurationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  minAge?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxAge?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  minWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxWeight?: number | null;

  @IsOptional()
  @IsIn(['CAPPED', 'OVER', 'OPEN'])
  weightKind?: string;

  @ApiPropertyOptional({ enum: CompetitionFormat })
  @IsOptional()
  @IsEnum(CompetitionFormat)
  format?: CompetitionFormat;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(16)
  laneCount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxEntriesPerCountry?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  athleteIds?: string[];
}
