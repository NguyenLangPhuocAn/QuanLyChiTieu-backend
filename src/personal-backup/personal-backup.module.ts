import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PersonalBackupController } from './personal-backup.controller';
import { PersonalBackupService } from './personal-backup.service';

@Module({
  imports: [PrismaModule, TransactionsModule],
  controllers: [PersonalBackupController],
  providers: [PersonalBackupService],
})
export class PersonalBackupModule {}
