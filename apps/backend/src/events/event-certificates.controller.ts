import { Body, Controller, Delete, Get, Param, Patch, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsObject } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { EventCertificatesService } from './event-certificates.service';

class SaveCertificateDto {
  @IsObject()
  design!: object;
}

@Controller('events/:eventId/certificates')
@UseGuards(JwtAuthGuard)
export class EventCertificatesController {
  constructor(private readonly certificates: EventCertificatesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  config(@Param('eventId') id: string) { return this.certificates.config(id); }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  save(@Param('eventId') id: string, @Body() dto: SaveCertificateDto) { return this.certificates.save(id, dto.design); }

  @Get('recipients')
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  recipients(@Param('eventId') id: string) { return this.certificates.recipients(id); }

  @Get('background')
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  async background(@Param('eventId') id: string, @Res() response: Response) {
    const file = await this.certificates.background(id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.data);
  }

  @Patch('background')
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(@Param('eventId') id: string, @UploadedFile() file?: Express.Multer.File) { return this.certificates.uploadBackground(id, file); }

  @Delete('background')
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  remove(@Param('eventId') id: string) { return this.certificates.removeBackground(id); }
}
