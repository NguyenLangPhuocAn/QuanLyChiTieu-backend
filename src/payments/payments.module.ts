import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { VnpayService } from './vnpay.service';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController],
  providers: [VnpayService],
})
export class PaymentsModule {}
