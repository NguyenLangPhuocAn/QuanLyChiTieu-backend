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
import { parsePaymentLinkIds } from './payment-link-ids';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
  };
};

const parseQueryAmount = (value: string | undefined, label: string) => {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`${label} không hợp lệ.`);
  }
  return parsed;
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
    @Query('min_amount') minAmount?: string,
    @Query('max_amount') maxAmount?: string,
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
      minAmount: parseQueryAmount(minAmount, 'Số tiền tối thiểu'),
      maxAmount: parseQueryAmount(maxAmount, 'Số tiền tối đa'),
      page: parseQueryInteger(page, 'Trang'),
      limit: parseQueryInteger(limit, 'Số kết quả'),
    });
  }

  @Get('linked-payments')
  linkedPayments(@Req() req: AuthenticatedRequest, @Query('ids') ids?: string) {
    return this.transactionsService.linkedPayments(
      req.user.userId,
      parsePaymentLinkIds(ids),
    );
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

  @Post('import-excel')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
      fileFilter: (_request, file, callback) => {
        const isExcel =
          file.originalname.toLocaleLowerCase().endsWith('.xlsx') ||
          file.mimetype ===
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        callback(
          isExcel ? null : new BadRequestException('Chỉ hỗ trợ file XLSX.'),
          isExcel,
        );
      },
    }),
  )
  importExcel(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Query('rows') rows?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file Excel.');
    }
    const selectedRows = rows
      ? new Set(
          rows
            .split(',')
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 2),
        )
      : undefined;
    if (selectedRows && selectedRows.size === 0) {
      throw new BadRequestException('Chưa chọn dòng nào để nhập.');
    }
    if (selectedRows && selectedRows.size > 500) {
      throw new BadRequestException(
        'Mỗi lần chỉ nhập tối đa 500 dòng đã chọn.',
      );
    }
    return this.transactionsService.importExcel(
      req.user.userId,
      file.buffer,
      false,
      selectedRows,
    );
  }

  @Post('preview-excel')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
      fileFilter: (_request, file, callback) => {
        const isExcel =
          file.originalname.toLocaleLowerCase().endsWith('.xlsx') ||
          file.mimetype ===
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        callback(
          isExcel ? null : new BadRequestException('Chỉ hỗ trợ file XLSX.'),
          isExcel,
        );
      },
    }),
  )
  previewExcel(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file Excel.');
    }
    return this.transactionsService.previewExcel(req.user.userId, file.buffer);
  }

  @Delete('import-batches/:id')
  undoExcelImport(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.transactionsService.undoExcelImport(req.user.userId, id);
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
