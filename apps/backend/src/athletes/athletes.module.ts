import { Module } from '@nestjs/common';
import { AthletesService } from './athletes.service';
import { AthletesController } from './athletes.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AthleteIdentityService } from './athlete-identity.service';
import { SystemSettingsModule } from '../system-settings/system-settings.module';

@Module({
  imports: [PrismaModule, SystemSettingsModule],
  controllers: [AthletesController],
  providers: [AthletesService, AthleteIdentityService],
  exports: [AthletesService, AthleteIdentityService],
})
export class AthletesModule {}
