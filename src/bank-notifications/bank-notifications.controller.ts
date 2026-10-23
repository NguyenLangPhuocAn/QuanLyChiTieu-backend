import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { BankNotificationExtractionService } from './bank-notification-extraction.service';
import { ExtractBankNotificationDto } from './dto/extract-bank-notification.dto';

@Controller('bank-notifications')
@UseGuards(JwtGuard)
export class BankNotificationsController {
  constructor(private readonly extraction: BankNotificationExtractionService) {}

  @Post('extract')
  @HttpCode(200)
  extract(
    @Req() req: { user: { userId: number } },
    @Body() dto: ExtractBankNotificationDto,
  ) {
    return this.extraction.extract(req.user.userId, dto);
  }
}
