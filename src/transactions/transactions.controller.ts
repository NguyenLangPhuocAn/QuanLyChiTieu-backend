import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { join } from 'path';
import { JwtGuard } from '../auth/jwt.guard';
import {
  createImageUploadOptions,
  deleteUploadedFile,
  IMAGE_UPLOAD_LIMITS,
} from '../common/upload/image-upload-options';
import {
  CreateTransactionDto,
  TransactionType,
} from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
  };
};

const receiptUploadDir = join(process.cwd(), 'uploads', 'receipts');

@Controller('transactions')
@UseGuards(JwtGuard)
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('wallet_id') walletId?: string,
    @Query('category_id') categoryId?: string,
    @Query('type') type?: 'INCOME' | 'EXPENSE',
    @Query('cash_flow') cashFlow?: 'normal' | 'loan_debt',
    @Query('tag') tag?: string,
    @Query('q') q?: string,
    @Query('note') note?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.transactionsService.findAll(req.user.userId, {
      walletId: walletId ? Number(walletId) : undefined,
      categoryId: categoryId ? Number(categoryId) : undefined,
      type: type ? TransactionType[type] : undefined,
      cashFlow,
      tag,
      q,
      note,
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateTransactionDto,
  ) {
    const transaction = await this.transactionsService.create(
      req.user.userId,
      dto,
    );

    return transaction;
  }

  @Put(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTransactionDto,
  ) {
    const transaction = await this.transactionsService.update(
      req.user.userId,
      id,
      dto,
    );

    return transaction;
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const transaction = await this.transactionsService.remove(
      req.user.userId,
      id,
    );

    return transaction;
  }

  @Post(':id/receipt')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createImageUploadOptions({
        destination: receiptUploadDir,
        fileSize: IMAGE_UPLOAD_LIMITS.receipt.fileSize,
      }),
    ),
  )
  async uploadReceipt(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn ảnh hóa đơn');
    }

    let transaction: Awaited<ReturnType<TransactionsService['uploadReceipt']>>;

    try {
      transaction = await this.transactionsService.uploadReceipt(
        req.user.userId,
        id,
        file.filename,
      );
    } catch (error) {
      await deleteUploadedFile(file);
      throw error;
    }

    return transaction;
  }
}
