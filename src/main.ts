import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { loadEnvFile } from './env';
import type { NextFunction, Request, Response } from 'express';
import { UploadExceptionFilter } from './common/upload/upload-exception.filter';

async function bootstrap() {
  loadEnvFile();
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
  });
  // validate DTO
  app.useGlobalFilters(new UploadExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );
  await app.listen(3000);
}
void bootstrap();
