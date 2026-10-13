import { ScoreboardService } from './scoreboard.service';
import { ScoreboardCommandDto } from './dto/scoreboard.dto';
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { EnterResultDto, ResultActionDto } from './dto/result-workflow.dto';
import { ResultsService } from './results.service';
import { ScoreboardLeaseDto } from './dto/scoreboard-lease.dto';

@ApiTags('result-workflow')
@Controller('results')
@UseGuards(JwtAuthGuard)
export class ResultsController {
  constructor(private readonly results: ResultsService, private readonly scoreboard: ScoreboardService) {}

  @Get('matches/:matchId/scoreboard')
  @Roles(UserRole.GAMES_ADMIN)
  getScoreboard(@Param('matchId') id: string) { return this.scoreboard.get(id); }

  @Post('matches/:matchId/scoreboard/claim')
  @Roles(UserRole.GAMES_ADMIN)
  claimScoreboard(@Param('matchId') id: string, @Req() req: { user: { id: string } }, @Body() dto: ScoreboardLeaseDto) {
    return this.scoreboard.claim(id, req.user.id, dto.clientId);
  }

  @Post('matches/:matchId/scoreboard/heartbeat')
  @Roles(UserRole.GAMES_ADMIN)
  heartbeatScoreboard(@Param('matchId') id: string, @Req() req: { user: { id: string } }, @Body() dto: ScoreboardLeaseDto) {
    return this.scoreboard.heartbeat(id, req.user.id, dto.clientId);
  }

  @Post('matches/:matchId/scoreboard/release')
  @Roles(UserRole.GAMES_ADMIN)
  releaseScoreboard(@Param('matchId') id: string, @Req() req: { user: { id: string } }, @Body() dto: ScoreboardLeaseDto) {
    return this.scoreboard.release(id, req.user.id, dto.clientId);
  }

  @Post('matches/:matchId/scoreboard')
  @Roles(UserRole.GAMES_ADMIN)
  scoreboardCommand(@Param('matchId') id: string, @Req() req: { user: { id: string } }, @Body() dto: ScoreboardCommandDto) {
    return this.scoreboard.command(id, req.user.id, dto);
  }

  @Get('matches/:matchId')
  @Roles(
    UserRole.GAMES_ADMIN,
    UserRole.READ_ONLY,
  )
  get(@Param('matchId') matchId: string) {
    return this.results.get(matchId);
  }

  @Post('matches/:matchId/enter')
  @Roles(UserRole.GAMES_ADMIN)
  @ApiOperation({ summary: 'Enter or correct a draft result' })
  enter(
    @Param('matchId') matchId: string,
    @Req() req: { user: { id: string } },
    @Body() dto: EnterResultDto,
  ) {
    return this.results.enter(matchId, req.user.id, dto);
  }

  @Post('matches/:matchId/correction-preview')
  @Roles(UserRole.GAMES_ADMIN)
  @ApiOperation({ summary: 'Preview corrected winner/loser progression without saving changes' })
  previewCorrection(@Param('matchId') matchId: string, @Req() req: { user: { id: string } }, @Body() dto: EnterResultDto) {
    return this.results.previewCorrection(matchId, req.user.id, dto);
  }

  @Post('matches/:matchId/referee-confirm')
  @Roles(UserRole.GAMES_ADMIN)
  confirm(
    @Param('matchId') matchId: string,
    @Req() req: { user: { id: string } },
    @Body() dto: ResultActionDto,
  ) {
    return this.results.confirm(matchId, req.user.id, dto.expectedVersion, dto.reason);
  }

  @Post('matches/:matchId/approve')
  @Roles(UserRole.GAMES_ADMIN)
  approve(
    @Param('matchId') matchId: string,
    @Req() req: { user: { id: string } },
    @Body() dto: ResultActionDto,
  ) {
    return this.results.approve(matchId, req.user.id, dto.expectedVersion, dto.reason);
  }

  @Post('matches/:matchId/publish')
  @Roles(UserRole.GAMES_ADMIN)
  publish(
    @Param('matchId') matchId: string,
    @Req() req: { user: { id: string } },
    @Body() dto: ResultActionDto,
  ) {
    return this.results.publish(matchId, req.user.id, dto.expectedVersion, dto.reason);
  }

  @Post('matches/:matchId/lock')
  @Roles(UserRole.GAMES_ADMIN)
  lock(
    @Param('matchId') matchId: string,
    @Req() req: { user: { id: string } },
    @Body() dto: ResultActionDto,
  ) {
    return this.results.lock(matchId, req.user.id, dto.expectedVersion, dto.reason);
  }

  @Post('matches/:matchId/reopen')
  @Roles(UserRole.ADMIN)
  reopen(
    @Param('matchId') matchId: string,
    @Req() req: { user: { id: string } },
    @Body() dto: ResultActionDto,
  ) {
    return this.results.reopen(matchId, req.user.id, dto.expectedVersion, dto.reason);
  }
}
