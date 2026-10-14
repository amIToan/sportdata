import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DrawType } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const seedingModes = [
  'STANDARD',
  'ORDERED',
  'RANDOM',
  'COUNTRY_SEPARATED',
  'FEDERATION_SEPARATED',
] as const;

export type SeedingMode = (typeof seedingModes)[number];

export class GenerateDrawDto {
  @ApiProperty({ type: [String], description: 'All eligible athlete IDs; CompetitionEntry seeds take priority over input order' })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsString({ each: true })
  athleteIds: string[];

  @ApiPropertyOptional({ enum: [DrawType.MAIN_TREE, DrawType.REPECHAGE, DrawType.REPECHAGE_QUARTERFINALS, DrawType.DOUBLE_ELIMINATION, DrawType.ROUND_ROBIN_POOL] })
  @IsEnum(DrawType)
  @IsOptional()
  type?: DrawType = DrawType.MAIN_TREE;

  @ApiPropertyOptional({ enum: seedingModes, default: 'STANDARD' })
  @IsIn(seedingModes)
  @IsOptional()
  seedingMode?: SeedingMode = 'STANDARD';

  @ApiPropertyOptional({ example: 'MAIN TREE POOL 1' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  divisionId?: string;

  @ApiPropertyOptional({ example: 'FOP 1' })
  @IsString()
  @IsOptional()
  fop?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['FOP 1', 'FOP 2'],
    description: 'Danh sách sàn được dùng cho cây; các trận được phân bổ luân phiên',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  fops?: string[];

  @ApiPropertyOptional({ minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  startMatchNumber?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 16, default: 1 })
  @IsInt()
  @Min(1)
  @Max(16)
  @IsOptional()
  groupCount?: number;
}
