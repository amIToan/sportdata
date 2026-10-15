import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ImageVariant, ImageVariantPipe } from '../storage/image-variant';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateEventParticipationDto, UpdateEventParticipationStatusDto } from './dto/create-event-participation.dto';
import { EventParticipationsService } from './event-participations.service';
import { OptionalParticipantAuthGuard } from './optional-participant-auth.guard';
import { ParticipantAuthGuard } from './participant-auth.guard';
import { AdminEventParticipationDto } from './dto/admin-event-participation.dto';

@Controller('participant-auth')
export class EventParticipationsController {
  constructor(private readonly service: EventParticipationsService) {}

  @Post('admin/event-participations')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  createAdmin(@Body() dto: AdminEventParticipationDto,
    @Req() request: Request & { user?: { email?: string; sub?: string } }) {
    return this.service.createAdmin(dto, request.user?.email || request.user?.sub || 'CMS');
  }

  @Post('admin/event-participations/new')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  createNewAdmin(@Body() dto: CreateEventParticipationDto,
    @Req() request: Request & { user?: { email?: string; sub?: string } }) {
    return this.service.create(dto, undefined, request.user?.email || request.user?.sub || 'CMS');
  }

  @Post('event-participations')
  @UseGuards(OptionalParticipantAuthGuard)
  create(@Body() dto: CreateEventParticipationDto, @Req() request: Request & { participant?: { id: string } }) {
    return this.service.create(dto, request.participant?.id);
  }

  @Get('event-participations/:id/avatar')
  async avatar(@Param('id') id: string, @Res() response: Response, @Query('variant', ImageVariantPipe) variant?: ImageVariant) {
    const media = await this.service.getPublicAvatar(id, variant);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(media.data);
  }

  @Get('admin/event-participations/:id/media/:type')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  async adminMedia(@Param('id') id: string, @Param('type') type: string, @Res() response: Response,
    @Query('variant', ImageVariantPipe) variant?: ImageVariant) {
    const media = await this.service.getAdminMedia(id, type, variant);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', 'inline');
    response.send(media.data);
  }

  @Get('event-participations')
  @UseGuards(ParticipantAuthGuard)
  listMine(@Req() request: Request & { participant: { id: string } }, @Query('eventId') eventId?: string) {
    return this.service.listMine(request.participant.id, eventId);
  }

  @Get('admin/event-participations')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  listAdmin(@Query('eventId') eventId?: string) {
    return this.service.listAdmin(eventId);
  }

  @Patch('admin/event-participations/:id/status')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateEventParticipationStatusDto,
    @Req() request: Request & { user?: { email?: string; username?: string; sub?: string } }) {
    return this.service.updateStatus(id, dto, request.user?.email || request.user?.username || request.user?.sub || 'CMS');
  }
}
