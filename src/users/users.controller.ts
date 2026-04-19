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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // ================= AUTH =================

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.usersService.login(dto.email, dto.password);
  }

  @Post('logout')
  logout() {
    return {
      message: 'Logout',
    };
  }

  // ================= PROFILE =================

  @UseGuards(JwtGuard)
  @Get('me')
  getProfile(@Req() req: any) {
    return this.usersService.findOne(req.user.userId);
  }

  // ================= UPDATE PROFILE =================

  @UseGuards(JwtGuard)
  @Put('me')
  updateProfile(@Req() req: any, @Body() dto: UpdateUserDto) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  // ================= CHANGE PASSWORD =================

  @UseGuards(JwtGuard)
  @Put('change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(req.user.userId, dto);
  }

  // ================= ADMIN =================

  @UseGuards(JwtGuard, AdminGuard)
  @Get()
  getAll() {
    return this.usersService.findAll();
  }

  // ================= REGISTER =================

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  // ================= CRUD (ADMIN ONLY) =================

  @UseGuards(JwtGuard, AdminGuard)
  @Get('detail/:id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Put('detail/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.usersService.update(id, body);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Delete('detail/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }
}