import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  Query,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import {
  CompletePasswordSetupDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/forgot-password.dto';

import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

type AuthenticatedRequest = Request & {
  // Sau khi qua JwtGuard, thông tin user đã giải mã sẽ được gắn vào req.user.
  user: {
    userId: number;
    email?: string;
    role?: string;
  };
};

function generateUploadFilename(file: Express.Multer.File) {
  // Giữ phần đuôi file gốc và thêm tiền tố unique để tránh trùng tên khi upload.
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
}

// Avatar của user được tách ra thư mục riêng thay vì dùng chung với các loại file khác.
const userAvatarUploadDir = join(process.cwd(), 'uploads', 'avatars');

function ensureUserAvatarUploadDir() {
  // Tạo thư mục đích nếu chưa tồn tại để lần upload đầu tiên không bị lỗi.
  mkdirSync(userAvatarUploadDir, { recursive: true });
  return userAvatarUploadDir;
}

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private prisma: PrismaService,
  ) {}

  private getUserLogLabel(user: {
    id?: number;
    full_name?: string | null;
    email?: string | null;
  }) {
    return user.full_name?.trim() || user.email?.trim() || `id: ${user.id}`;
  }

  private async logAdminAction(req: AuthenticatedRequest, action: string) {
    if (req.user.role !== 'ADMIN') {
      return;
    }

    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action,
      },
    });
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.usersService.login(dto.email, dto.password);
  }

  @Post('refresh')
  refresh(@Body() body: { refreshToken?: string }) {
    return this.usersService.refresh(body.refreshToken ?? '');
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.usersService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(dto);
  }

  @UseGuards(JwtGuard)
  @Post('logout')
  async logout(
    @Req() req: AuthenticatedRequest,
    @Body() body: { refreshToken?: string },
  ) {
    const result = await this.usersService.logout(
      req.user.userId,
      body.refreshToken,
    );

    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action: `Người dùng đăng xuất hệ thống (id: ${req.user.userId})`,
      },
    });

    return result;
  }

  @UseGuards(JwtGuard)
  @Get('me')
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.usersService.findOne(req.user.userId);
  }

  @UseGuards(JwtGuard)
  @Put('me')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateUserDto,
  ) {
    const user = await this.usersService.updateProfile(req.user.userId, dto);

    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action: `Cập nhật hồ sơ người dùng (id: ${req.user.userId})`,
      },
    });

    return user;
  }

  @UseGuards(JwtGuard)
  @Put('me/upgrade-premium')
  async upgradeSelfToPremium(@Req() req: AuthenticatedRequest) {
    const user = await this.usersService.upgradeSelfToPremium(req.user.userId);

    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action: `Người dùng nâng cấp Premium (id: ${req.user.userId})`,
      },
    });

    return user;
  }

  @UseGuards(JwtGuard)
  @Put('me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        // Mỗi lần upload đều resolve lại thư mục đích để chắc chắn folder đã sẵn sàng.
        destination: (req, file, cb) => {
          cb(null, ensureUserAvatarUploadDir());
        },
        filename: (req, file, cb) => {
          // Backend chỉ lưu tên file trong DB, còn đường dẫn public sẽ được ghép ở frontend.
          const uniqueName = generateUploadFilename(file);
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        // Chỉ nhận các định dạng ảnh được hỗ trợ để tránh upload nhầm file khác.
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(new Error('Chỉ cho phép tải lên tệp hình ảnh'), false);
        }

        cb(null, true);
      },
    }),
  )
  async uploadAvatar(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // User tự đổi avatar của chính mình nên dùng userId lấy từ token.
    const user = await this.usersService.updateProfile(req.user.userId, {
      avatar: file.filename,
    });

    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action: `Upload avatar người dùng (id: ${req.user.userId})`,
      },
    });

    return user;
  }

  @UseGuards(JwtGuard)
  @Delete('me')
  async deactivateMe(@Req() req: AuthenticatedRequest) {
    const user = await this.usersService.deactivateSelf(req.user.userId);

    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action: `Người dùng tự vô hiệu hóa tài khoản (${this.getUserLogLabel(user)})`,
      },
    });

    return {
      message: 'Tài khoản đã được vô hiệu hóa',
      user,
      forceLogout: true,
    };
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Put('detail/:id/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        // Admin upload avatar cho user khác nhưng vẫn dùng cùng thư mục avatar riêng.
        destination: (req, file, cb) => {
          cb(null, ensureUserAvatarUploadDir());
        },
        filename: (req, file, cb) => {
          // Chuẩn hóa cách đặt tên để luồng admin và self-service dùng cùng format file.
          const uniqueName = generateUploadFilename(file);
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        // Giữ cùng rule validate ảnh như endpoint me/avatar để hành vi đồng nhất.
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(new Error('Chỉ cho phép tải lên tệp hình ảnh'), false);
        }

        cb(null, true);
      },
    }),
  )
  async uploadAvatarByAdmin(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // Admin chỉ định user theo param id và cập nhật trường avatar bằng tên file mới.
    const user = await this.usersService.updateAvatar(id, file.filename, req.user);

    await this.logAdminAction(
      req,
      `Admin upload avatar người dùng (${this.getUserLogLabel(user)})`,
    );

    return user;
  }

  @UseGuards(JwtGuard)
  @Put('change-password')
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    const result = await this.usersService.changePassword(req.user.userId, dto);

    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action: `Người dùng đổi mật khẩu (id: ${req.user.userId})`,
      },
    });

    return result;
  }

  @UseGuards(JwtGuard)
  @Put('complete-password-setup')
  async completePasswordSetup(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CompletePasswordSetupDto,
  ) {
    const result = await this.usersService.completePasswordSetup(
      req.user.userId,
      dto,
    );

    await this.prisma.admin_logs.create({
      data: {
        admin_id: req.user.userId,
        action: `Người dùng tạo mật khẩu mới lần đầu (id: ${req.user.userId})`,
      },
    });

    return result;
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Get()
  getAll(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('keyword') keyword?: string,
    @Query('role') role?: string,
    @Query('sort') sort?: string,
  ) {
    return this.usersService.findAll(req.user, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      keyword,
      role,
      sort,
    });
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const user = await this.usersService.create(dto);

    await this.prisma.admin_logs.create({
      data: {
        admin_id: user.id,
        action: `Tạo người dùng (${this.getUserLogLabel(user)})`,
      },
    });

    return user;
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Post('admin')
  async createByAdmin(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AdminCreateUserDto,
  ) {
    const user = await this.usersService.createByAdmin(dto, req.user);

    await this.logAdminAction(
      req,
      `Admin tạo người dùng (${this.getUserLogLabel(user)})`,
    );

    return user;
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Get('detail/:id')
  getOne(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.findOneForAdmin(id, req.user);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Put('detail/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    const user = await this.usersService.update(id, body, req.user);

    await this.logAdminAction(
      req,
      `Admin cập nhật người dùng (${this.getUserLogLabel(user)})`,
    );

    return user;
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Delete('detail/:id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const user = await this.usersService.remove(id, req.user);

    await this.logAdminAction(
      req,
      `Admin vô hiệu hóa người dùng (${this.getUserLogLabel(user)})`,
    );

    return user;
  }
}
