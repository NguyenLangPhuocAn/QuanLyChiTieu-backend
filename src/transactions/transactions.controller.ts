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
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { JwtGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto, TransactionType } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
    role?: string | null;
  };
};

const receiptUploadDir = join(process.cwd(), 'uploads', 'receipts');

function ensureReceiptUploadDir() {
  mkdirSync(receiptUploadDir, { recursive: true });
  return receiptUploadDir;
}

function generateUploadFilename(file: Express.Multer.File) {
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
}

@Controller('transactions')
@UseGuards(JwtGuard)
export class TransactionsController {
  constructor(
    private transactionsService: TransactionsService,
    private prisma: PrismaService,
  ) {}

  private async logAction(userId: number, role: string | null | undefined, action: string) {
    if (role !== 'ADMIN') {
      return;
    }

    await this.prisma.admin_logs.create({
      data: {
        admin_id: userId,
        action,
      },
    });
  }

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('wallet_id') walletId?: string,
    @Query('category_id') categoryId?: string,
    @Query('type') type?: 'INCOME' | 'EXPENSE',
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

    await this.logAction(
      req.user.userId,
      req.user.role,
      `Tạo giao dịch (id: ${transaction.id})`,
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

    await this.logAction(req.user.userId, req.user.role, `Cập nhật giao dịch (id: ${id})`);

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

    await this.logAction(req.user.userId, req.user.role, `Xóa giao dịch (id: ${id})`);

    return transaction;
  }

  @Post(':id/receipt')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, ensureReceiptUploadDir());
        },
        filename: (req, file, cb) => {
          cb(null, generateUploadFilename(file));
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(
            new BadRequestException('Chỉ cho phép tải lên tệp hình ảnh'),
            false,
          );
        }

        cb(null, true);
      },
    }),
  )
  async uploadReceipt(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn ảnh hóa đơn');
    }

    const transaction = await this.transactionsService.uploadReceipt(
      req.user.userId,
      id,
      file.filename,
    );

    await this.logAction(
      req.user.userId,
      req.user.role,
      `Upload ảnh hóa đơn giao dịch (id: ${id})`,
    );

    return transaction;
  }
}
