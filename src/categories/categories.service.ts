import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-categories.dto';
import { UpdateCategoryDto } from './dto/update-categories.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  // ================= CREATE =================
  async create(userId: number, dto: CreateCategoryDto) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền tạo category');
    }

    const name = dto.name.trim().toLowerCase();

    // check trùng
    const existed = await this.prisma.categories.findFirst({
      where: {
        name,
        user_id: userId,
      },
    });

    if (existed) {
      throw new ForbiddenException('Danh mục đã tồn tại');
    }

    const isSystem =
      user?.role === 'ADMIN' && dto.is_system === true;

    return this.prisma.categories.create({
      data: {
        name,
        type: dto.type,
        is_system: isSystem,
        user_id: isSystem ? null : userId,
      },
    });
  }

  // ================= GET ALL =================
  async findAll(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (user?.role === 'BASIC') {
      return this.prisma.categories.findMany({
        where: { is_system: true },
        orderBy: { id: 'desc' },
      });
    }

    if (user?.role === 'PREMIUM') {
      return this.prisma.categories.findMany({
        where: {
          OR: [{ is_system: true }, { user_id: userId }],
        },
        orderBy: { id: 'desc' },
      });
    }

    return this.prisma.categories.findMany({
      orderBy: { id: 'desc' },
    });
  }

  // ================= UPDATE =================
  async update(userId: number, id: number, dto: UpdateCategoryDto) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Category không tồn tại');
    }

    // không cho update rỗng
    if (!dto.name && !dto.type) {
      throw new ForbiddenException('Không có dữ liệu để cập nhật');
    }

    const newName = dto.name?.trim().toLowerCase();

    // ===== ADMIN =====
    if (user?.role === 'ADMIN') {
      return this.prisma.categories.update({
        where: { id },
        data: {
          name: newName ?? undefined,
          type: dto.type,
        },
      });
    }

    // ===== BASIC =====
    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    // ===== PREMIUM =====
    if (category.is_system) {
      throw new ForbiddenException('Không thể sửa category hệ thống');
    }

    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    // check trùng khi update
    if (newName) {
      const existed = await this.prisma.categories.findFirst({
        where: {
          name: newName,
          user_id: userId,
          NOT: { id },
        },
      });

      if (existed) {
        throw new ForbiddenException('Danh mục đã tồn tại');
      }
    }

    return this.prisma.categories.update({
      where: { id },
      data: {
        name: newName ?? undefined,
        type: dto.type,
      },
    });
  }

  // ================= DELETE =================
  async remove(userId: number, id: number) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Category không tồn tại');
    }

    if (user?.role === 'ADMIN') {
      return this.prisma.categories.delete({
        where: { id },
      });
    }

    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    if (category.is_system) {
      throw new ForbiddenException('Không thể xoá category hệ thống');
    }

    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    return this.prisma.categories.delete({
      where: { id },
    });
  }

  // ================= UPLOAD ICON =================
  async uploadIcon(userId: number, id: number, filename: string) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Category không tồn tại');
    }

    if (user?.role === 'ADMIN') {
      return this.prisma.categories.update({
        where: { id },
        data: { icon: filename },
      });
    }

    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    if (category.is_system) {
      throw new ForbiddenException('Không thể sửa category hệ thống');
    }

    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    return this.prisma.categories.update({
      where: { id },
      data: { icon: filename },
    });
  }
}