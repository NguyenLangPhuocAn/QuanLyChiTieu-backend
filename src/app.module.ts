import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CategoriesModule } from './categories/categories.module';
import { WalletsModule } from './wallets/wallets.module';
import { TransactionsModule } from './transactions/transactions.module';
import { AdminModule } from './admin/admin.module';
import { CurrencyModule } from './currency/currency.module';
import { AuthModule } from './auth/auth.module';
import { StatisticsModule } from './statistics/statistics.module';
import { TagsModule } from './tags/tags.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    // Phục vụ file upload qua URL chung /uploads.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/public',
    }),
    CurrencyModule,
    CategoriesModule,
    WalletsModule,
    TransactionsModule,
    TagsModule,
    StatisticsModule,
    AdminModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
