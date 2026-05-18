import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GoogleController } from './google.controller';

@Module({
  imports: [UsersModule],
  controllers: [GoogleController],
})
export class AuthModule {}
