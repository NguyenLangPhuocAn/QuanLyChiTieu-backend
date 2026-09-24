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
import { memoryStorage } from 'multer';
import { join } from 'path';
import { JwtGuard } from '../auth/jwt.guard';
import {
  createImageUploadOptions,
  deleteUploadedFile,
  IMAGE_UPLOAD_LIMITS,
  imageFileFilter,
} from '../common/upload/image-upload-options';
import {
  CreateTransactionDto,
  TransactionType,
} from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';
import { ReceiptOcrService } from './receipt-ocr.service';
import { parseQueryInteger } from './parse-query-integer';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
  };
};

const receiptUploadDir = join(process.cwd(), 'uploads', 'receipts');

@Controller('transactions')
@UseGuards(JwtGuard)
export class TransactionsController {
  constructor(
    private transactionsService: TransactionsService,
    private receiptOcrService: ReceiptOcrService,
  ) {}

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
    if (type !== undefined && type !== 'INCOME' && type !== 'EXPENSE') {
      throw new BadRequestException('Loại giao dịch không hợp lệ.');
    }
    if (
      cashFlow !== undefined &&
      cashFlow !== 'normal' &&
      cashFlow !== 'loan_debt'
    ) {
      throw new BadRequestException('Nhóm dòng tiền không hợp lệ.');
    }
    return this.transactionsService.findAll(req.user.userId, {
      walletId: parseQueryInteger(walletId, 'Mã ví'),
      categoryId: parseQueryInteger(categoryId, 'Mã danh mục'),
      type: type ? TransactionType[type] : undefined,
      cashFlow,
      tag,
      q,
      note,
      from,
      to,
      page: parseQueryInteger(page, 'Trang'),
      limit: parseQueryInteger(limit, 'Số kết quả'),
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

  @Post('receipt-ocr')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: {
        fileSize: IMAGE_UPLOAD_LIMITS.receipt.fileSize,
        files: 1,
      },
    }),
  )
  analyzeReceipt(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn ảnh hóa đơn');
    }
    return this.receiptOcrService.analyze(req.user.userId, file);
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
