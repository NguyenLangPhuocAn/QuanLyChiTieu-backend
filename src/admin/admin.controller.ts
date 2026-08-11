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
import { AdminGuard } from '../auth/admin.guard';
import { JwtGuard } from '../auth/jwt.guard';
import {
  createImageUploadOptions,
  deleteUploadedFile,
  IMAGE_UPLOAD_LIMITS,
} from '../common/upload/image-upload-options';
import { CreateCategoryDto } from '../categories/dto/create-categories.dto';
import { UpdateCategoryDto } from '../categories/dto/update-categories.dto';
import { AdminService } from './admin.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
    email: string;
    role: string;
  };
};

const categoryIconTempUploadDir = join(
  process.cwd(),
  'uploads',
  'tmp',
  'category-icons',
);

@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('dashboard')
  getDashboard(
    @Req() req: AuthenticatedRequest,
    @Query('date') date?: string,
    @Query('period') period?: string,
  ) {
    return this.adminService.getDashboard(req.user.userId, date, period);
  }

  @Get('categories')
  getCategories() {
    return this.adminService.getCategories();
  }

  @Post('categories')
  createCategory(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.adminService.createCategory(req.user.userId, dto);
  }

  @Put('categories/:id')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.adminService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  removeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.removeCategory(id);
  }

  @Post('categories/:id/icon')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createImageUploadOptions({
        destination: categoryIconTempUploadDir,
        fileSize: IMAGE_UPLOAD_LIMITS.categoryIcon.fileSize,
      }),
    ),
  )
  async uploadCategoryIcon(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn tệp');
    }

    try {
      return await this.adminService.uploadCategoryIcon(id, file);
    } catch (error) {
      await deleteUploadedFile(file);
      throw error;
    }
  }

  @Get('logs')
  getLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('target') target?: string,
    @Query('date') date?: string,
    @Query('sort') sort?: string,
  ) {
    return this.adminService.getLogs({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      action,
      target,
      date,
      sort,
    });
  }

  @Post('logs')
  createLog(
    @Req() req: AuthenticatedRequest,
    @Body() body: { action?: string },
  ) {
    return this.adminService.createLog(req.user.userId, body.action);
  }
}
