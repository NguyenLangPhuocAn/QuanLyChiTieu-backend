import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FeaturesController } from './features.controller';
import { FeatureFlagsService } from './feature-flags.service';

@Module({
  imports: [PrismaModule],
  controllers: [FeaturesController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeaturesModule {}
