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
import { join } from 'path';
import {
  createImageUploadOptions,
  deleteUploadedFile,
  IMAGE_UPLOAD_LIMITS,
} from '../common/upload/image-upload-options';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
    role?: string;
  };
};

const categoryIconTempUploadDir = join(
  process.cwd(),
  'uploads',
  'tmp',
  'category-icons',
);

@Controller('categories')
@UseGuards(JwtGuard)
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCategoryDto,
  ) {
    const category = await this.categoriesService.create(req.user.userId, dto);

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

    return category;
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const category = await this.categoriesService.remove(req.user.userId, id);

    return category;
  }

  @Post(':id/icon')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createImageUploadOptions({
        destination: categoryIconTempUploadDir,
        fileSize: IMAGE_UPLOAD_LIMITS.categoryIcon.fileSize,
      }),
    ),
  )
  async uploadIcon(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn tệp');
    }

    let category: Awaited<ReturnType<CategoriesService['uploadIcon']>>;

    try {
      category = await this.categoriesService.uploadIcon(
        req.user.userId,
        id,
        file,
      );
    } catch (error) {
      await deleteUploadedFile(file);
      throw error;
    }

    return category;
  }
}
