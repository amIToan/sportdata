import { ImageVariant, ImageVariantPipe } from '../storage/image-variant';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { AthleteMediaType } from '@prisma/client';
import type { Request, Response } from 'express';
import { ParticipantsService } from './participants.service';
import { ParticipantAuthGuard } from './participant-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import {
  CreatePublicRegistrationDto,
  AdminCreateRegistrationDto,
  ConfirmIdentityOcrDto,
  DownloadSubmissionTicketsDto,
  UpdateAccountTypesDto,
  ParticipantLoginDto,
  ParticipantForgotPasswordDto,
  ParticipantResetPasswordDto,
  ParticipantRegisterDto,
  UpdateParticipantProfileDto,
  UpdateDocumentVerificationDto,
  UpdateRegistrationStatusDto,
  UpdateRegistrationCategoryDto,
  UpdateRegistrationPaymentStatusDto,
  UpdateAccountVerificationDto,
} from './dto/participant.dto';
import { TicketPdfService } from './ticket-pdf.service';
import { EventParticipationsService } from './event-participations.service';
import { CheckAthleteIdentityDto } from './dto/check-athlete-identity.dto';
import { LookupAthleteDto } from './dto/lookup-athlete.dto';

type ParticipantRequest = Request & { participant: { id: string } };

@Controller('participant-auth')
export class ParticipantsController {
  constructor(
    private readonly service: ParticipantsService,
    private readonly ticketPdf: TicketPdfService,
    private readonly eventParticipations: EventParticipationsService,
  ) {}

  @Post('register')
  register(@Body() dto: ParticipantRegisterDto) {
    return this.service.register(dto);
  }

  @Post('login')
  login(@Body() dto: ParticipantLoginDto) {
    return this.service.login(dto);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ParticipantForgotPasswordDto) {
    return this.service.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ParticipantResetPasswordDto) {
    return this.service.resetPassword(dto);
  }

  @Post('media-uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3_500_000, files: 1 } }))
  createMediaUpload(
    @Body('type') type: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.createMediaUpload(type, file);
  }

  @Post('guest-registrations')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 8 * 1024 * 1024, files: 120 } }))
  createGuestRegistrations(
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.service.createGuestRegistrations(this.registrationPayload(body), files);
  }

  @Post('identity/check')
  checkIdentity(@Body() dto: CheckAthleteIdentityDto) {
    return this.service.checkAthleteIdentity(dto);
  }

  @Post('identity/lookup')
  @Header('Cache-Control', 'private, no-store')
  lookupIdentity(@Body() dto: LookupAthleteDto) {
    return this.service.lookupAthlete(dto);
  }

  @Post('team/registrations')
  @UseGuards(ParticipantAuthGuard)
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 8 * 1024 * 1024, files: 120 } }))
  createFederationRegistrations(
    @Req() request: ParticipantRequest,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.service.createGuestRegistrations(this.registrationPayload(body), files, request.participant.id, true);
  }

  @Post('assisted-registrations')
  @UseGuards(ParticipantAuthGuard)
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 8 * 1024 * 1024, files: 120 } }))
  createAssistedRegistrations(
    @Req() request: ParticipantRequest,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.service.createGuestRegistrations(this.registrationPayload(body), files, request.participant.id);
  }

  private registrationPayload(body: Record<string, unknown>) {
    return typeof body?.payload === 'string' ? body.payload : JSON.stringify(body || {});
  }

  @Get('team/me')
  @UseGuards(ParticipantAuthGuard)
  federationMe(@Req() request: ParticipantRequest) {
    return this.service.getTeamProfile(request.participant.id);
  }

  @Post('ocr/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  previewIdentityOcr(
    @Body('type') type: AthleteMediaType,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.previewIdentityOcr(type, file);
  }

  @Get('me')
  @UseGuards(ParticipantAuthGuard)
  me(@Req() request: ParticipantRequest) {
    return this.service.getProfile(request.participant.id);
  }

  @Patch('me')
  @UseGuards(ParticipantAuthGuard)
  updateMe(@Req() request: ParticipantRequest, @Body() dto: UpdateParticipantProfileDto) {
    return this.service.updateProfile(request.participant.id, dto);
  }

  @Post('me/media/:type')
  @UseGuards(ParticipantAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  uploadMedia(
    @Req() request: ParticipantRequest,
    @Param('type') type: AthleteMediaType,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.upsertMedia(request.participant.id, type, file);
  }

  @Patch('me/media/:type/ocr-confirm')
  @UseGuards(ParticipantAuthGuard)
  confirmMediaOcr(
    @Req() request: ParticipantRequest,
    @Param('type') type: AthleteMediaType,
    @Body() dto: ConfirmIdentityOcrDto,
  ) {
    return this.service.confirmIdentityOcr(request.participant.id, type, dto);
  }

  @Get('me/media/:type')
  @UseGuards(ParticipantAuthGuard)
  async ownMedia(
    @Req() request: ParticipantRequest,
    @Param('type') type: AthleteMediaType,
    @Res() response: Response,
    @Query('variant', ImageVariantPipe) variant?: ImageVariant,
  ) {
    const media = await this.service.getOwnMedia(request.participant.id, type, variant);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', 'inline');
    response.send(media.data);
  }

  @Get('avatar/:athleteId')
  async avatar(
    @Param('athleteId') athleteId: string,
    @Res() response: Response,
    @Query('variant', ImageVariantPipe) variant?: ImageVariant,
  ) {
    const media = await this.service.getAvatar(athleteId, variant);
    if ('url' in media) {
      response.setHeader('Cache-Control', 'public, max-age=300');
      return response.redirect(302, media.url);
    }
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.send(media.data);
  }

  @Get('tickets/:ticketCode')
  ticket(@Param('ticketCode') ticketCode: string) {
    if (ticketCode.trim().toUpperCase().startsWith('SDP-')) return this.eventParticipations.getTicket(ticketCode);
    return this.service.getTicket(ticketCode);
  }

  @Get('tickets/:ticketCode/pdf')
  async ticketPdfFile(@Param('ticketCode') ticketCode: string, @Res() response: Response) {
    const ticket = ticketCode.trim().toUpperCase().startsWith('SDP-')
      ? await this.eventParticipations.getIssuedTicket(ticketCode, true)
      : await this.service.getIssuedTicket(ticketCode, true);
    const pdf = await this.ticketPdf.generate([ticket]);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="sportdata-${ticket.ticketCode}-A6.pdf"`);
    response.send(pdf);
  }

  @Post('submissions/:referenceCode/tickets.pdf')
  async submissionTicketsPdf(
    @Param('referenceCode') referenceCode: string,
    @Body() dto: DownloadSubmissionTicketsDto,
    @Res() response: Response,
  ) {
    const batch = await this.service.getSubmissionTickets(referenceCode, dto.contactEmail, true);
    const pdf = await this.ticketPdf.generate(batch.tickets, batch.meta);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="sportdata-${batch.meta.referenceCode}-A6.pdf"`);
    response.send(pdf);
  }

  @Get('admin/registrations')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  adminRegistrations(@Query('eventId') eventId?: string) {
    return this.service.listAllRegistrations(eventId);
  }

  @Post('admin/registrations/eligibility')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  checkAdminRegistrationEligibility(@Body() dto: AdminCreateRegistrationDto) {
    return this.service.checkAdminRegistrationEligibility(dto);
  }

  @Post('admin/registrations')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  createAdminRegistration(
    @Req() request: Request & { user?: { email?: string; username?: string; sub?: string } },
    @Body() dto: AdminCreateRegistrationDto,
  ) {
    return this.service.createAdminRegistration(
      dto,
      request.user?.email || request.user?.username || request.user?.sub || 'CMS',
    );
  }

  @Patch('admin/accounts/:id/status')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  updateAccountStatus(@Param('id') id: string, @Body() dto: UpdateAccountVerificationDto) {
    return this.service.updateAccountStatus(id, dto.status);
  }

  @Patch('admin/accounts/:id/types')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  updateAccountTypes(@Param('id') id: string, @Body() dto: UpdateAccountTypesDto) {
    return this.service.updateAccountTypes(id, dto.accountTypes);
  }

  @Patch('admin/registrations/:id/category')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  updateRegistrationCategory(
    @Req() request: Request & { user?: { email?: string; username?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateRegistrationCategoryDto,
  ) {
    return this.service.updateRegistrationCategory(
      id,
      dto.categoryId,
      request.user?.email || request.user?.username || request.user?.sub || 'CMS',
    );
  }

  @Patch('admin/registrations/:id/status')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  updateRegistrationStatus(
    @Req() request: Request & { user?: { email?: string; username?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateRegistrationStatusDto,
  ) {
    return this.service.updateRegistrationStatus(
      id,
      dto.status,
      dto.reason,
      request.user?.email || request.user?.username || request.user?.sub || 'CMS',
    );
  }

  @Delete('admin/registrations/:id')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  deleteRegistration(@Param('id') id: string) {
    return this.service.deleteRegistration(id);
  }

  @Patch('admin/registrations/:id/payment-status')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  updateRegistrationPaymentStatus(
    @Req() request: Request & { user?: { email?: string; username?: string; sub?: string } },
    @Param('id') id: string,
    @Body() dto: UpdateRegistrationPaymentStatusDto,
  ) {
    return this.service.updateRegistrationPaymentStatus(
      id,
      dto.status,
      dto.reason,
      request.user?.email || request.user?.username || request.user?.sub || 'CMS',
    );
  }

  @Get('admin/athletes/:athleteId/media/:type')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  async adminMedia(
    @Param('athleteId') athleteId: string,
    @Param('type') type: AthleteMediaType,
    @Res() response: Response,
    @Query('variant', ImageVariantPipe) variant?: ImageVariant,
  ) {
    const media = await this.service.getMedia(athleteId, type, variant);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(media.data);
  }

  @Patch('admin/athletes/:athleteId/media/:type/verification')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  updateDocumentVerification(
    @Req() request: Request & { user?: { email?: string; sub?: string } },
    @Param('athleteId') athleteId: string,
    @Param('type') type: AthleteMediaType,
    @Body() dto: UpdateDocumentVerificationDto,
  ) {
    return this.service.updateDocumentVerification(
      athleteId,
      type,
      dto.status,
      dto.note,
      request.user?.email || request.user?.sub || 'CMS',
    );
  }

  @Post('registrations')
  @UseGuards(ParticipantAuthGuard)
  createRegistration(@Req() request: ParticipantRequest, @Body() dto: CreatePublicRegistrationDto) {
    return this.service.createRegistration(request.participant.id, dto);
  }

  @Get('registrations/state')
  @UseGuards(ParticipantAuthGuard)
  registrationState(@Req() request: ParticipantRequest, @Query('eventId') eventId?: string) {
    return this.service.getOwnRegistrationState(request.participant.id, eventId);
  }

  @Get('registrations')
  @UseGuards(ParticipantAuthGuard)
  registrations(@Req() request: ParticipantRequest) {
    return this.service.listRegistrations(request.participant.id);
  }
}
