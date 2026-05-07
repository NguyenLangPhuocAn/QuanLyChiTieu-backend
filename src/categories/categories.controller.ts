import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { CategoriesService } from './categories.service';
import { JwtGuard } from '../auth/jwt.guard';
import { CreateCategoryDto } from './dto/create-categories.dto';
import { UpdateCategoryDto } from './dto/update-categories.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PrismaService } from '../prisma/prisma.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
    role?: string;
  };
};

@Controller('categories')
@UseGuards(JwtGuard)
export class CategoriesController {
  constructor(
    private categoriesService: CategoriesService,
    private prisma: PrismaService,
  ) {}

  private async logAction(req: AuthenticatedRequest, action: string) {
    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action,
      },
    });
  }

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCategoryDto,
  ) {
    const category = await this.categoriesService.create(req.user.userId, dto);

    await this.logAction(
      req,
      `Tạo danh mục (id: ${category.id})`,
    );

    return category;
  }

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.categoriesService.findAll(req.user.userId);
  }

  @Put(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    const category = await this.categoriesService.update(
      req.user.userId,
      id,
      dto,
    );

    await this.logAction(
      req,
      `Cập nhật danh mục (id: ${id})`,
    );

    return category;
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const category = await this.categoriesService.remove(req.user.userId, id);

    await this.logAction(
      req,
      `Xóa danh mục (id: ${category.id})`,
    );

    return category;
  }

  @Post(':id/icon')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
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
  async uploadIcon(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn tệp');
    }

    const category = await this.categoriesService.uploadIcon(
      req.user.userId,
      id,
      file,
    );

    await this.logAction(
      req,
      `Upload icon danh mục (id: ${category.id})`,
    );

    return category;
  }
}
