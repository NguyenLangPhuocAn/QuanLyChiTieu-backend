import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { CreateWalletTransferDto } from './dto/create-wallet-transfer.dto';
import { SavingsService } from './savings.service';

type AuthRequest = Request & { user: { userId: number } };

@Controller('wallet-transfers')
@UseGuards(JwtGuard)
export class WalletTransfersController {
  constructor(private readonly savingsService: SavingsService) {}

  @Get()
  findAll(@Req() req: AuthRequest) {
    return this.savingsService.findTransfers(req.user.userId);
  }

  @Post()
  create(@Req() req: AuthRequest, @Body() dto: CreateWalletTransferDto) {
    return this.savingsService.transferBetweenWallets(req.user.userId, dto);
  }
}
