import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { NotificationsService } from './notifications.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
  };
};

@Controller('admin/notifications')
@UseGuards(JwtGuard, AdminGuard)
export class NotificationsAdminController {
  constructor(private notificationsService: NotificationsService) {}

  @Get('broadcasts')
  listBroadcasts(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.notificationsService.listBroadcasts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('broadcasts')
  createBroadcast(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateBroadcastDto,
  ) {
    return this.notificationsService.createBroadcast(req.user.userId, dto);
  }

  @Delete('broadcasts/:id')
  recallBroadcast(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.notificationsService.recallBroadcast(req.user.userId, id);
  }
}
