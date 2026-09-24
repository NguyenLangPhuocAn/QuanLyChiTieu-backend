import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SavingsController } from './savings.controller';
import { SavingsService } from './savings.service';
import { WalletTransfersController } from './wallet-transfers.controller';

@Module({
  imports: [PrismaModule, CurrencyModule],
  controllers: [SavingsController, WalletTransfersController],
  providers: [SavingsService],
  exports: [SavingsService],
})
export class SavingsModule {}
