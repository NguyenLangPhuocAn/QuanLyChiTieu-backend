import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

type UserBase = {
  id: number;
  email: string;
  role: string | null;
  full_name?: string | null;
  phone?: string | null;
  birthday?: Date | null;
  address?: string | null;
  avatar?: string | null;
  currency_default?: string | null;
};

type UserWithWalletCount = UserBase & {
  wallet_count: number;
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Lấy số lượng ví của một user để hiển thị trong trang quản lý người dùng.
  private async getWalletCount(userId: number) {
    return this.prisma.wallets.count({
      where: { user_id: userId },
    });
  }

  // Gắn thêm trường wallet_count vào dữ liệu user trước khi trả về cho frontend.
  private async attachWalletCount<T extends UserBase>(user: T | null) {
    if (!user) {
      return null;
    }

    const wallet_count = await this.getWalletCount(user.id);

    return {
      ...user,
      wallet_count,
    } as T & { wallet_count: number };
  }

  // Gắn thêm wallet_count cho danh sách user.
  private async attachWalletCountList<T extends UserBase>(users: T[]) {
    return Promise.all(users.map((user) => this.attachWalletCount(user)));
  }

  // ================= GET ALL =================
  async findAll() {
    const users = await this.prisma.users.findMany({
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    return this.attachWalletCountList(users);
  }

  // ================= GET ONE =================
  async findOne(id: number) {
    const user = await this.prisma.users.findUnique({
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
        currency_default: true,
      },
    });

    return this.attachWalletCount(user);
  }

  // ================= CREATE (REGISTER) =================
  async create(dto: CreateUserDto) {
    // Kiểm tra mật khẩu và xác nhận mật khẩu có khớp nhau không.
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Mật khẩu xác nhận không khớp');
    }

    // Kiểm tra email đã tồn tại hay chưa.
    const existingUser = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email đã tồn tại');
    }

    // Mã hóa mật khẩu trước khi lưu xuống database.
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
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Nếu cập nhật mật khẩu thì phải băm lại trước khi lưu.
    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }

    // Chuyển ngày sinh từ chuỗi sang Date nếu có gửi lên.
    if (dto.birthday) {
      dto.birthday = new Date(dto.birthday);
    }

    const updatedUser = await this.prisma.users.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        email: true,
        role: true,
        full_name: true,
      },
    });

    return {
      ...updatedUser,
      wallet_count: await this.getWalletCount(id),
    };
  }

  // ================= UPDATE AVATAR (ADMIN) =================
  async updateAvatar(id: number, avatar: string) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    const updatedUser = await this.prisma.users.update({
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
        currency_default: true,
      },
    });

    return {
      ...updatedUser,
      wallet_count: await this.getWalletCount(id),
    };
  }

  // ================= DELETE =================
  async remove(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
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

    await this.prisma.admin_logs.create({
      data: {
        admin_id: user.id,
        action: 'Người dùng đăng nhập hệ thống',
      },
    });

    return {
      message: 'Đăng nhập thành công',
      token,
    };
  }

  // ================= CHANGE PASSWORD =================
  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Kiểm tra mật khẩu cũ trước khi cho đổi mật khẩu mới.
    const isMatch = await bcrypt.compare(dto.oldPassword, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Mật khẩu cũ không đúng');
    }

    // Mật khẩu mới và xác nhận phải khớp nhau.
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
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Chuyển birthday sang Date nếu người dùng có cập nhật.
    if (dto.birthday) {
      dto.birthday = new Date(dto.birthday);
    }

    const updatedUser = await this.prisma.users.update({
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
        currency_default: true,
      },
    });

    return {
      ...updatedUser,
      wallet_count: await this.getWalletCount(userId),
    };
  }
}
