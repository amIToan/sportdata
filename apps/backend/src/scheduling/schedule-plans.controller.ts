import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { ApplyScheduleDto, DeleteScheduleDraftDto, PreviewScheduleDto, SaveScheduleDraftDto } from './dto/schedule-plan.dto';
import { SchedulePlansService } from './schedule-plans.service';

@Controller('scheduling/events/:eventId')
@UseGuards(JwtAuthGuard)
export class SchedulePlansController {
  constructor(private readonly plans: SchedulePlansService) {}

  @Get('planner-input') @Roles(UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  input(@Param('eventId') eventId: string) { return this.plans.plannerInput(eventId); }

  @Get('plans/overview') @Roles(UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  overview(@Param('eventId') eventId: string) { return this.plans.overview(eventId); }

  @Get('plans/:planId') @Roles(UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  detail(@Param('eventId') eventId: string, @Param('planId') planId: string) { return this.plans.detail(eventId, planId); }

  @Post('plans') @Roles(UserRole.GAMES_ADMIN)
  create(@Param('eventId') eventId: string, @Req() request: any, @Body() dto: SaveScheduleDraftDto) {
    return this.plans.create(eventId, request.user.id, dto);
  }

  @Put('plans/:planId/draft') @Roles(UserRole.GAMES_ADMIN)
  save(@Param('eventId') eventId: string, @Param('planId') planId: string, @Req() request: any, @Body() dto: SaveScheduleDraftDto) {
    return this.plans.save(eventId, planId, request.user.id, dto);
  }

  @Post('plans/:planId/preview') @Roles(UserRole.GAMES_ADMIN)
  preview(@Param('eventId') eventId: string, @Param('planId') planId: string, @Req() request: any, @Body() dto: PreviewScheduleDto) {
    return this.plans.preview(eventId, planId, request.user.id, dto);
  }

  @Delete('plans/:planId/draft') @Roles(UserRole.GAMES_ADMIN)
  deleteDraft(@Param('eventId') eventId: string, @Param('planId') planId: string, @Req() request: any, @Body() dto: DeleteScheduleDraftDto) {
    return this.plans.deleteDraft(eventId, planId, request.user.id, dto);
  }

  @Post('plans/:planId/apply') @Roles(UserRole.GAMES_ADMIN)
  apply(@Param('eventId') eventId: string, @Param('planId') planId: string, @Req() request: any, @Body() dto: ApplyScheduleDto) {
    return this.plans.apply(eventId, planId, request.user.id, dto);
  }

  @Get('plans/:planId/revisions') @Roles(UserRole.GAMES_ADMIN, UserRole.READ_ONLY)
  revisions(@Param('eventId') eventId: string, @Param('planId') planId: string) { return this.plans.revisions(eventId, planId); }
}
