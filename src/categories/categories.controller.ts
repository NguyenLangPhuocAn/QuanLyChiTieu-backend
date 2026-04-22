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
import { CategoriesService } from './categories.service';
import { JwtGuard } from '../auth/jwt.guard';
import { CreateCategoryDto } from './dto/create-categories.dto';
import { UpdateCategoryDto } from './dto/update-categories.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';

@Controller('categories')
@UseGuards(JwtGuard)
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  // ================= CREATE =================
  @Post()
  create(@Req() req: any, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(req.user.userId, dto);
  }

  // ================= GET ALL =================
  @Get()
  findAll(@Req() req: any) {
    return this.categoriesService.findAll(req.user.userId);
  }

  // ================= UPDATE =================
  @Put(':id')
  update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(
      req.user.userId,
      id,
      dto,
    );
  }

  // ================= DELETE =================
  @Delete(':id')
  remove(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.categoriesService.remove(
      req.user.userId,
      id,
    );
  }

  // ================= UPLOAD ICON =================
  @Post(':id/icon')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/categories',
        filename: (req, file, cb) => {
          const uniqueName = Date.now() + '-' + file.originalname;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(new BadRequestException('Chỉ cho phép file ảnh'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadIcon(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // check không có file
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file');
    }

    return this.categoriesService.uploadIcon(
      req.user.userId,
      id,
      file.filename,
    );
  }
}