import { Module } from '@nestjs/common';
import { AthletesService } from './athletes.service';
import { AthletesController } from './athletes.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AthleteIdentityService } from './athlete-identity.service';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { AthletePerformanceService } from './athlete-performance.service';

@Module({
  imports: [PrismaModule, SystemSettingsModule],
  controllers: [AthletesController],
  providers: [AthletesService, AthleteIdentityService, AthletePerformanceService],
  exports: [AthletesService, AthleteIdentityService],
})
export class AthletesModule {}
