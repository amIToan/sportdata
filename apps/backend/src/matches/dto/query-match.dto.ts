import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsDateString,
  IsIn,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MatchStatus } from '@prisma/client';

export class QueryMatchDto {
  @ApiPropertyOptional({ description: 'Lọc trận có VĐV thuộc đơn vị / CLB' })
  @IsString()
  @IsOptional()
  federationId?: string;

  @ApiPropertyOptional({ description: 'Hide completed automatic bracket byes from match lists', enum: ['true', 'false'] })
  @IsIn(['true', 'false'])
  @IsOptional()
  hideByes?: 'true' | 'false';

  @ApiPropertyOptional({ description: 'Sort by match number before pagination', enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  matchNumberOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Tên VĐV, ở bất kỳ bên nào của trận' })
  @IsString()
  @IsOptional()
  athleteName?: string;

  @ApiPropertyOptional({ description: 'Tên đối thủ; kết hợp với athleteName để tìm cặp đấu' })
  @IsString()
  @IsOptional()
  opponentName?: string;

  @ApiPropertyOptional({ description: 'Số trận đấu' })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @IsOptional()
  @Type(() => Number)
  matchNumber?: number;

  @ApiPropertyOptional({ description: 'Vòng đấu' })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @IsOptional()
  @Type(() => Number)
  round?: number;

  @ApiPropertyOptional({ description: 'Tìm theo vận động viên hoặc tên sự kiện' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  eventId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Các ID hạng đấu, phân cách bằng dấu phẩy' })
  @IsString()
  @IsOptional()
  categoryIds?: string;

  @ApiPropertyOptional({ description: 'Sắp xếp theo thứ tự thi đấu trong sự kiện', enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  scheduleOrder?: 'asc' | 'desc';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sportId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo FOP cụ thể' })
  @IsString()
  @IsOptional()
  fopId?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tên địa điểm, sàn hoặc FOP' })
  @IsString()
  @IsOptional()
  venue?: string;

  @ApiPropertyOptional({ description: 'Lọc các trận có vận động viên này' })
  @IsString()
  @IsOptional()
  athleteId?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({ enum: MatchStatus })
  @IsEnum(MatchStatus)
  @IsOptional()
  status?: MatchStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ enum: ['page', 'cursor'], default: 'page' })
  @IsIn(['page', 'cursor'])
  @IsOptional()
  pagination?: 'page' | 'cursor';

  @ApiPropertyOptional({ description: 'ID trận cuối của trang trước' })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
