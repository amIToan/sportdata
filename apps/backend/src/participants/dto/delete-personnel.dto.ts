import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class DeletePersonnelDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}
