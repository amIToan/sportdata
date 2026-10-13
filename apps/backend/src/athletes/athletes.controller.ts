import { ImageVariant, ImageVariantPipe } from '../storage/image-variant';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  Header,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { AthleteMediaType } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AthletesService } from './athletes.service';
import { CreateAthleteDto } from './dto/create-athlete.dto';
import { UpdateAthleteDto } from './dto/update-athlete.dto';
import { QueryAthletesDto } from './dto/query-athletes.dto';
import { BulkDeleteAthletesDto, PreviewAthleteDeleteDto } from './dto/bulk-delete-athletes.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';

@ApiTags('athletes')
@Controller('athletes')
export class AthletesController {
  constructor(private readonly athletesService: AthletesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @ApiOperation({ summary: 'Create a new athlete' })
  @ApiResponse({ status: 201, description: 'Athlete created successfully' })
  create(@Body() createAthleteDto: CreateAthleteDto) {
    return this.athletesService.create(createAthleteDto);
  }

  @Post('bulk-delete/preview')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Capture all athletes matching the current filters before bulk deletion' })
  previewBulkDelete(@Body() dto: PreviewAthleteDeleteDto) {
    return this.athletesService.previewBulkDelete(dto);
  }

  @Post('bulk-delete')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete selected athletes or a confirmed filter snapshot, reporting every failure' })
  bulkDelete(@Body() dto: BulkDeleteAthletesDto) {
    return this.athletesService.bulkDelete(dto);
  }

  @Post(':id/avatar')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  uploadAvatar(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.athletesService.uploadAvatar(id, file);
  }

  @Get(':id/documents')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  getDocuments(@Param('id') id: string) {
    return this.athletesService.getDocuments(id);
  }

  @Get(':id/identity-details')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  @Header('Cache-Control', 'private, no-store')
  getIdentityDetails(@Param('id') id: string) {
    return this.athletesService.getIdentityDetails(id);
  }

  @Get(':id/documents/:type')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  async getDocument(
    @Param('id') id: string,
    @Param('type') type: AthleteMediaType,
    @Res() response: Response,
    @Query('variant', ImageVariantPipe) variant?: ImageVariant,
  ) {
    const document = await this.athletesService.getDocument(id, type, variant);
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', 'inline');
    response.send(document.data);
  }

  @Post(':id/documents/:type')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024 } }))
  uploadDocument(
    @Param('id') id: string,
    @Param('type') type: AthleteMediaType,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.athletesService.uploadDocument(id, type, file);
  }

  @Delete(':id/documents/:type')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  deleteDocument(@Param('id') id: string, @Param('type') type: AthleteMediaType) {
    return this.athletesService.deleteDocument(id, type);
  }

  @Get()
  @ApiOperation({ summary: 'Get all athletes with search and filters' })
  @ApiResponse({ status: 200, description: 'Athletes retrieved successfully' })
  findAll(@Query() query: QueryAthletesDto) {
    return this.athletesService.findAll(query);
  }

  @Get('filter-options')
  @ApiOperation({ summary: 'Get country facets for the current athlete filters' })
  getFilterOptions(@Query() query: QueryAthletesDto) {
    return this.athletesService.getFilterOptions(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get athlete by ID' })
  @ApiResponse({ status: 200, description: 'Athlete found' })
  @ApiResponse({ status: 404, description: 'Athlete not found' })
  findOne(@Param('id') id: string) {
    return this.athletesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @ApiOperation({ summary: 'Update athlete by ID' })
  @ApiResponse({ status: 200, description: 'Athlete updated successfully' })
  @ApiResponse({ status: 404, description: 'Athlete not found' })
  update(
    @Param('id') id: string,
    @Body() updateAthleteDto: UpdateAthleteDto,
  ) {
    return this.athletesService.update(id, updateAthleteDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete athlete by ID' })
  @ApiResponse({ status: 204, description: 'Athlete deleted successfully' })
  @ApiResponse({ status: 404, description: 'Athlete not found' })
  remove(@Param('id') id: string) {
    return this.athletesService.remove(id);
  }
}
