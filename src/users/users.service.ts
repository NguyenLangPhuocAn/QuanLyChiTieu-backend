import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ================= GET ALL =================
  findAll() {
    return this.prisma.users.findMany({
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }

  // ================= GET ONE =================
  findOne(id: number) {
    return this.prisma.users.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
        phone: true,
        birthday: true,
        address: true,
        avatar: true,
      },
    });
  }

  // ================= CREATE (REGISTER) =================
  async create(dto: CreateUserDto) {
    // check confirm password
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    // check email tồn tại
    const existingUser = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email đã tồn tại');
    }

    // hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    return this.prisma.users.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        role: 'BASIC',
      },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }

  // ================= UPDATE (ADMIN) =================
  async update(id: number, dto: any) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    // ❗ nếu update password thì phải hash
    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }

    // ❗ convert date
    if (dto.birthday) {
      dto.birthday = new Date(dto.birthday);
    }

    return this.prisma.users.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        email: true,
        role: true,
      },
    });
  }

  // ================= UPDATE AVATAR (ADMIN) =================
  async updateAvatar(id: number, avatar: string) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User khÃ´ng tá»“n táº¡i');
    }

    return this.prisma.users.update({
      where: { id },
      data: { avatar },
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
        phone: true,
        birthday: true,
        address: true,
        avatar: true,
      },
    });
  }

  // ================= DELETE =================
  async remove(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    return this.prisma.users.delete({
      where: { id },
    });
  }

  // ================= LOGIN =================
  async login(email: string, password: string) {
    const user = await this.prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: '1d' },
    );

    return {
      message: 'Login success',
      token,
    };
  }

  // ================= CHANGE PASSWORD =================
  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    // check password cũ
    const isMatch = await bcrypt.compare(dto.oldPassword, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Mật khẩu cũ không đúng');
    }

    // check confirm
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.users.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
      },
    });

    return {
      message: 'Đổi mật khẩu thành công',
    };
  }

  // ================= UPDATE PROFILE =================
  async updateProfile(userId: number, dto: any) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User không tồn tại');
    }

    // convert birthday
    if (dto.birthday) {
      dto.birthday = new Date(dto.birthday);
    }

    return this.prisma.users.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
        phone: true,
        birthday: true,
        address: true,
        avatar: true,
      },
    });
  }
}
