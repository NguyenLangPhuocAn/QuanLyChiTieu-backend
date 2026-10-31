import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { loadEnvFile } from './env';
import { UploadExceptionFilter } from './common/upload/upload-exception.filter';
import { serverAddress } from './server-config';
import compression from 'compression';
import type { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  loadEnvFile();
  const { port, host } = serverAddress();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '1mb' });
  app.use(compression());
  app.enableShutdownHooks();
  app.enableCors();
  // validate DTO
  app.useGlobalFilters(new UploadExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );
  await app.listen(port, host);
}
void bootstrap();
