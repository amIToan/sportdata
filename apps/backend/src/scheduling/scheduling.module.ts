import { Module } from '@nestjs/common';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { SchedulePlansService } from './schedule-plans.service';
import { SchedulePlansController } from './schedule-plans.controller';

@Module({
  controllers: [SchedulePlansController, SchedulingController],
  providers: [SchedulingService, SchedulePlansService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
