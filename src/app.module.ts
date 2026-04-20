import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CategoriesModule } from './categories/categories.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    // ================= SERVE STATIC (uploads) =================
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'), // thư mục uploads
      serveRoot: '/uploads', // URL truy cập
    }),
    CategoriesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}