import { Controller, Get, Header, Param, ParseEnumPipe, Query, Res, UseGuards } from '@nestjs/common';
import { AthleteMediaType } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { ImageVariant, ImageVariantPipe } from '../storage/image-variant';
import { ListParticipantAccountsDto } from './dto/list-participant-accounts.dto';
import { ParticipantAccountsService } from './participant-accounts.service';

@Controller('participant-auth/admin/accounts')
@UseGuards(JwtAuthGuard)
@Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
export class ParticipantAccountsController {
  constructor(private readonly service: ParticipantAccountsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListParticipantAccountsDto) {
    return this.service.list(query);
  }

  @Get(':id/media/:type')
  async media(
    @Param('id') id: string,
    @Param('type', new ParseEnumPipe(AthleteMediaType)) type: AthleteMediaType,
    @Res() response: Response,
    @Query('variant', ImageVariantPipe) variant?: ImageVariant,
  ) {
    const media = await this.service.getMedia(id, type, variant);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', 'inline');
    response.send(media.data);
  }
}
