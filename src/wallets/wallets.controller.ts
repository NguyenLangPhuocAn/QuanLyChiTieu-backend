import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { WalletsService } from './wallets.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
  };
};

@Controller('wallets')
@UseGuards(JwtGuard)
export class WalletsController {
  constructor(
    private walletsService: WalletsService,
    private prisma: PrismaService,
  ) {}

  private async logAction(userId: number, action: string) {
    await this.prisma.admin_logs.create({
      data: {
        admin_id: userId,
        action,
      },
    });
  }

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.walletsService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.walletsService.findOne(req.user.userId, id);
  }

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateWalletDto) {
    const wallet = await this.walletsService.create(req.user.userId, dto);

    await this.logAction(req.user.userId, `Tạo ví (id: ${wallet.id})`);

    return wallet;
  }

  @Put(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWalletDto,
  ) {
    const wallet = await this.walletsService.update(req.user.userId, id, dto);

    await this.logAction(req.user.userId, `Cập nhật ví (id: ${id})`);

    return wallet;
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const wallet = await this.walletsService.remove(req.user.userId, id);

    await this.logAction(req.user.userId, `Xóa ví (id: ${id})`);

    return wallet;
  }
}
