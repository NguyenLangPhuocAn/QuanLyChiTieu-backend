import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { AdminService } from './admin.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
    email: string;
    role: string;
  };
};

@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('dashboard')
  getDashboard(@Query('date') date?: string) {
    return this.adminService.getDashboard(date);
  }

  @Get('logs')
  getLogs() {
    return this.adminService.getLogs();
  }

  @Post('logs')
  createLog(
    @Req() req: AuthenticatedRequest,
    @Body() body: { action?: string },
  ) {
    return this.adminService.createLog(req.user.userId, body.action);
  }
}
