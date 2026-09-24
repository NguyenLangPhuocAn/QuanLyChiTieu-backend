import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { CreateVnpayOrderDto } from './dto/create-vnpay-order.dto';
import { VnpayService } from './vnpay.service';

type AuthenticatedRequest = Request & {
  user: { userId: number; email: string; role: string | null };
};

@Controller('payments')
export class PaymentsController {
  constructor(private readonly vnpayService: VnpayService) {}

  private params(query: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(query)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, value as string]),
    );
  }

  @UseGuards(JwtGuard)
  @Get('plans/premium')
  getPremiumPlan() {
    return this.vnpayService.getPremiumPlan();
  }

  @UseGuards(JwtGuard)
  @Post('vnpay/orders')
  createOrder(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateVnpayOrderDto,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ) {
    return this.vnpayService.createOrder(
      req.user.userId,
      dto,
      forwardedFor || req.ip,
    );
  }

  @Get('vnpay/ipn')
  async ipn(@Query() query: Record<string, unknown>) {
    const result = await this.vnpayService.processResponse(this.params(query));
    return this.vnpayService.ipnResponse(result);
  }

  @Get('vnpay/return')
  async paymentReturn(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const result = await this.vnpayService.processResponse(this.params(query));
    return response.type('html').send(this.vnpayService.returnHtml(result));
  }

  @UseGuards(JwtGuard)
  @Get('orders')
  findAll(@Req() req: AuthenticatedRequest) {
    return this.vnpayService.findAll(req.user.userId);
  }

  @UseGuards(JwtGuard)
  @Get('orders/:orderCode')
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param('orderCode') orderCode: string,
  ) {
    return this.vnpayService.findOne(req.user.userId, orderCode);
  }
}
