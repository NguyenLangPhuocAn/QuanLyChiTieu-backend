import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CurrencyService } from './currency.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}
