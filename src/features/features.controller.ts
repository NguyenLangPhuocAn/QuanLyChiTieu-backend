import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('features')
@UseGuards(JwtGuard)
export class FeaturesController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  getFlags() {
    return this.flags.publicFlags();
  }
}
