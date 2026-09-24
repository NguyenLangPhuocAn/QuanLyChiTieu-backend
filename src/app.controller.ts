import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'quan-ly-chi-tieu' };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
