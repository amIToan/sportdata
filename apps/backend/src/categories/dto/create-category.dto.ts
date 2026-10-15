import { IsIn, IsString, IsOptional, IsNumber, IsEnum, IsArray, IsInt, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BeltLevel,
  CompetitionFormat,
  Gender,
  JiuJitsuDiscipline,
  UniformType,
} from '@prisma/client';

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  sportId: string;

  @ApiProperty({ enum: Gender })
  @IsEnum(Gender)
  gender: Gender;

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

  @ApiPropertyOptional({ description: 'Thời lượng trận tính bằng giây' })
  @IsOptional()
  @IsNumber()
  matchDurationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  minAge?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxAge?: number;

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

  @ApiPropertyOptional({ description: 'Số làn thi đấu cho heat/lane/relay' })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(16)
  laneCount?: number;

  @ApiPropertyOptional({ description: 'Số entry tối đa của mỗi quốc gia' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxEntriesPerCountry?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  athleteIds?: string[];
}
