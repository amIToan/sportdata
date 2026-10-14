import { DrawPreconfigureGuard } from '../auth/draw-preconfigure.guard';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Sse,
  StreamableFile,
} from '@nestjs/common';
import { defer, switchMap } from 'rxjs';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MatchesService } from './matches.service';
import { MatchExportService } from './match-export.service';
import { CreateMatchDto } from './dto/create-match.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { QueryMatchDto } from './dto/query-match.dto';
import { RevertDrawDto } from './dto/revert-draw.dto';
import { GenerateDrawDto } from './dto/generate-draw.dto';
import { QueryDrawPreconfigurationDto, SaveDrawPreconfigurationDto, PreviewDrawDto } from './dto/draw-preconfiguration.dto';
import { MatchStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { PublicEventStreamService } from './public-event-stream.service';

@ApiTags('matches')
@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    private readonly publicEventStream: PublicEventStreamService,
    private readonly matchExport: MatchExportService,
  ) {}

  @Get('event/:eventId/export/matches.csv')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Export the match table columns across all filtered pages' })
  async exportMatches(@Param('eventId') eventId: string, @Query() query: QueryMatchDto) {
    return new StreamableFile(await this.matchExport.csv(eventId, query), {
      type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="sportdata-matches.csv"',
    });
  }

  @Sse('event/:eventId/stream')
  @ApiOperation({ summary: 'Subscribe to public event schedule changes' })
  streamSchedule(@Param('eventId') eventId: string) {
    return defer(() => this.publicEventStream.stream(eventId)).pipe(switchMap((stream) => stream));
  }

  @Get()
  @ApiOperation({
    summary: 'List matches with filters and pagination',
    description:
      'Query matches by eventId, categoryId, date, status with pagination support.',
  })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'athleteName', required: false, type: String })
  @ApiQuery({ name: 'opponentName', required: false, type: String })
  @ApiQuery({ name: 'matchNumber', required: false, type: Number })
  @ApiQuery({ name: 'round', required: false, type: Number })
  @ApiQuery({ name: 'eventId', required: false, type: String })
  @ApiQuery({ name: 'categoryId', required: false, type: String })
  @ApiQuery({ name: 'sportId', required: false, type: String })
  @ApiQuery({ name: 'fopId', required: false, type: String })
  @ApiQuery({ name: 'venue', required: false, type: String })
  @ApiQuery({ name: 'athleteId', required: false, type: String })
  @ApiQuery({ name: 'date', required: false, type: String, example: '2024-01-15' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: MatchStatus,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'pagination', required: false, enum: ['page', 'cursor'] })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'hideByes', required: false, enum: ['true', 'false'] })
  @UseGuards(OptionalJwtAuthGuard)
  findAll(@Query() query: QueryMatchDto, @Req() request: { user?: unknown }) {
    return this.matchesService.findAll(query, Boolean(request.user));
  }

  @Get('event/:eventId/schedule-summary')
  @ApiOperation({
    summary: 'Get lightweight schedule metadata for an event',
    description: 'Returns match counts by date and the first live match without loading full match records.',
  })
  @ApiParam({ name: 'eventId', type: String, description: 'Event ID' })
  findScheduleSummary(@Param('eventId') eventId: string, @Query() query: QueryMatchDto) {
    return this.matchesService.findScheduleSummary(eventId, query.hideByes === 'true');
  }

  @Get('event/:eventId/category/:categoryId/draws')
  @ApiOperation({
    summary: 'Get the draw graphs of a category',
    description:
      'Returns round-robin, main, pool-winner and loser-bracket draws with explicit match progression links.',
  })
  @ApiParam({ name: 'eventId', type: String, description: 'Event ID' })
  @ApiParam({ name: 'categoryId', type: String, description: 'Category ID' })
  @UseGuards(OptionalJwtAuthGuard)
  findDraws(
    @Param('eventId') eventId: string,
    @Param('categoryId') categoryId: string,
    @Req() request: { user?: unknown },
  ) {
    return this.matchesService.findDraws(eventId, categoryId, Boolean(request.user));
  }

  @Get('event/:eventId/category/:categoryId/preconfiguration')
  @UseGuards(JwtAuthGuard, DrawPreconfigureGuard)
  @Roles(UserRole.ADMIN)
  getPreconfiguration(@Param('eventId') eventId: string, @Param('categoryId') categoryId: string,
    @Query() query: QueryDrawPreconfigurationDto) {
    return this.matchesService.getPreconfiguration(eventId, categoryId, query.drawType);
  }

  @Patch('event/:eventId/category/:categoryId/preconfiguration')
  @UseGuards(JwtAuthGuard, DrawPreconfigureGuard)
  @Roles(UserRole.ADMIN)
  savePreconfiguration(@Param('eventId') eventId: string, @Param('categoryId') categoryId: string,
    @Body() dto: SaveDrawPreconfigurationDto, @Req() request: { user: { id: string } }) {
    return this.matchesService.savePreconfiguration(eventId, categoryId, dto, request.user.id);
  }

  @Post('event/:eventId/category/:categoryId/preview-draw')
  @UseGuards(JwtAuthGuard, DrawPreconfigureGuard)
  @Roles(UserRole.ADMIN)
  previewDraw(@Param('eventId') eventId: string, @Param('categoryId') categoryId: string,
    @Body() dto: PreviewDrawDto, @Req() request: { user: { id: string } }) {
    return this.matchesService.previewDraw(eventId, categoryId, dto, request.user.id);
  }

  @Get('event/:eventId/category/:categoryId/preconfiguration/history')
  @UseGuards(JwtAuthGuard, DrawPreconfigureGuard)
  @Roles(UserRole.ADMIN)
  getPreconfigurationHistory(@Param('eventId') eventId: string, @Param('categoryId') categoryId: string,
    @Query() query: QueryDrawPreconfigurationDto) {
    return this.matchesService.getPreconfigurationHistory(eventId, categoryId, query.drawType);
  }

  @Get('event/:eventId/category/:categoryId/draw-state')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @ApiOperation({ summary: 'Check whether generated draws can be reverted before competition starts' })
  getDrawState(@Param('eventId') eventId: string, @Param('categoryId') categoryId: string) {
    return this.matchesService.getDrawState(eventId, categoryId);
  }

  @Post('event/:eventId/category/:categoryId/revert-draw')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @ApiOperation({ summary: 'Revert generated draws and fixtures of an unstarted category' })
  revertDraw(@Param('eventId') eventId: string, @Param('categoryId') categoryId: string,
    @Body() dto: RevertDrawDto, @Req() request: { user: { id: string } }) {
    return this.matchesService.revertDraw(eventId, categoryId, dto.version, request.user.id);
  }

  @Post('event/:eventId/category/:categoryId/generate-draw')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @ApiOperation({
    summary: 'Generate a seeded elimination graph',
    description:
      'Builds explicit winner/loser progression links. Supports standard, ordered, random, country-separated and federation-separated seeding.',
  })
  @ApiParam({ name: 'eventId', type: String, description: 'Event ID' })
  @ApiParam({ name: 'categoryId', type: String, description: 'Category ID' })
  generateDraw(
    @Param('eventId') eventId: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: GenerateDrawDto,
    @Req() request: { user: { id: string } },
  ) {
    return this.matchesService.generateDraw(eventId, categoryId, dto, request.user.id);
  }

  @Post('event/:eventId/distribute-dates')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  @ApiOperation({
    summary: 'Distribute unscheduled event matches evenly across event days',
    description:
      'Only changes matchDate for unlocked matches without an exact start time. Existing scheduled matches remain unchanged.',
  })
  @ApiParam({ name: 'eventId', type: String, description: 'Event ID' })
  distributeDates(@Param('eventId') eventId: string) {
    return this.matchesService.distributeEventMatchDates(eventId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single match by ID',
    description: 'Retrieve a match with all related data (event, category, athletes, winner).',
  })
  @ApiParam({ name: 'id', type: String, description: 'Match ID' })
  @UseGuards(OptionalJwtAuthGuard)
  findOne(@Param('id') id: string, @Req() request: { user?: unknown }) {
    return this.matchesService.findOne(id, Boolean(request.user));
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @ApiOperation({
    summary: 'Create a new match',
    description: 'Create an unfinished match with participants and scheduling details. Results use the approval workflow.',
  })
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createMatchDto: CreateMatchDto) {
    return this.matchesService.create(createMatchDto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTENT, UserRole.GAMES_ADMIN)
  @ApiOperation({
    summary: 'Update a match',
    description:
      'Update participants and scheduling details. Completed results must use the result approval workflow.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Match ID' })
  update(@Param('id') id: string, @Body() updateMatchDto: UpdateMatchDto) {
    return this.matchesService.update(id, updateMatchDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.GAMES_ADMIN)
  @ApiOperation({
    summary: 'Delete a match',
    description: 'Permanently remove a match by ID.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Match ID' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.matchesService.remove(id);
  }

  @Get('event/:eventId/grouped')
  @ApiOperation({
    summary: 'Get matches grouped by date and category for an event',
    description:
      'Returns all matches for an event organized in a nested structure: date -> category -> matches, similar to sportdata.org schedule view.',
  })
  @ApiParam({ name: 'eventId', type: String, description: 'Event ID' })
  @UseGuards(OptionalJwtAuthGuard)
  findGrouped(@Param('eventId') eventId: string, @Req() request: { user?: unknown }) {
    return this.matchesService.findGroupedByEventId(eventId, Boolean(request.user));
  }
}
