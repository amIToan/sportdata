import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { DrawType } from '@prisma/client';
import { GenerateDrawDto, SeedingMode, seedingModes } from './generate-draw.dto';

export const preconfigurationDrawTypes: DrawType[] = [
  DrawType.MAIN_TREE, DrawType.DOUBLE_ELIMINATION, DrawType.REPECHAGE, DrawType.REPECHAGE_QUARTERFINALS, DrawType.ROUND_ROBIN_POOL,
];

export class PreconfiguredPairDto {
  @IsString()
  entry1Id: string;

  @IsString()
  entry2Id: string;
}

export class SaveDrawPreconfigurationDto {
  @IsIn(preconfigurationDrawTypes)
  drawType: DrawType;

  @IsArray()
  @ArrayMaxSize(512)
  @ValidateNested({ each: true })
  @Type(() => PreconfiguredPairDto)
  pairs: PreconfiguredPairDto[];

  @IsIn(seedingModes)
  seedingMode: SeedingMode;

  @IsInt()
  @Min(0)
  revision: number;

  @IsInt()
  @Min(1)
  @Max(16)
  @IsOptional()
  groupCount?: number;
}

export class PreviewDrawDto extends GenerateDrawDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  revision?: number;
}

export class QueryDrawPreconfigurationDto {
  @IsIn(preconfigurationDrawTypes)
  drawType: DrawType;
}
