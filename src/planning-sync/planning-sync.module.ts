import { Module } from '@nestjs/common';
import { Controller, Get, Put, Req, Body, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanningSyncService } from './planning-sync.service';
type UserRequest = Request & { user: { userId: number } };
@Controller('planning-sync')
@UseGuards(JwtGuard)
export class PlanningSyncController {
  constructor(private readonly service: PlanningSyncService) {}
  @Get() get(@Req() req: UserRequest) {
    return this.service.get(req.user.userId);
  }
  @Put() put(@Req() req: UserRequest, @Body() body: unknown) {
    return this.service.put(req.user.userId, body);
  }
}
@Module({
  imports: [PrismaModule],
  controllers: [PlanningSyncController],
  providers: [PlanningSyncService],
})
export class PlanningSyncModule {}
