import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { join } from 'path';
import {
  copySeedCategoryIcons,
  deleteCategoryIcon,
  normalizeCategoryIconPath,
  saveCategoryIcon,
} from '../common/upload/category-icon-upload.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-categories.dto';
import { UpdateCategoryDto } from './dto/update-categories.dto';

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    const sourceDir = join(process.cwd(), '..', 'icons_categories');
    const copiedFiles = await copySeedCategoryIcons(sourceDir);

    if (copiedFiles.length === 0) {
      return;
    }

    await Promise.all(
      copiedFiles.map((file) =>
        this.prisma.categories.updateMany({
          where: { icon: file },
          data: { icon: normalizeCategoryIconPath(file) },
        }),
      ),
    );
  }

  async create(userId: number, dto: CreateCategoryDto) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (user?.role === 'BASIC') {
      throw new ForbiddenException(
        'Tài khoản Basic không có quyền tạo danh mục',
      );
    }

    const name = dto.name.trim().toLowerCase();
    const isSystem = user?.role === 'ADMIN' && dto.is_system === true;

    const existed = await this.prisma.categories.findFirst({
      where: isSystem
        ? {
            name,
            is_system: true,
          }
        : {
            name,
            user_id: userId,
          },
    });

    if (existed) {
      throw new ForbiddenException('Danh mục đã tồn tại');
    }

    return this.prisma.categories.create({
      data: {
        name,
        type: dto.type,
        is_system: isSystem,
        user_id: isSystem ? null : userId,
      },
    });
  }

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

  async update(userId: number, id: number, dto: UpdateCategoryDto) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    if (!dto.name && !dto.type) {
      throw new ForbiddenException('Không có dữ liệu để cập nhật');
    }

    const newName = dto.name?.trim().toLowerCase();

    if (newName) {
      const existed = await this.prisma.categories.findFirst({
        where: category.is_system
          ? {
              name: newName,
              is_system: true,
              NOT: { id },
            }
          : {
              name: newName,
              user_id: category.user_id,
              NOT: { id },
            },
      });

      if (existed) {
        throw new ForbiddenException('Danh mục đã tồn tại');
      }
    }

    if (user?.role === 'ADMIN') {
      return this.prisma.categories.update({
        where: { id },
        data: {
          name: newName ?? undefined,
          type: dto.type,
        },
      });
    }

    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    if (category.is_system) {
      throw new ForbiddenException('Không thể sửa danh mục hệ thống');
    }

    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    return this.prisma.categories.update({
      where: { id },
      data: {
        name: newName ?? undefined,
        type: dto.type,
      },
    });
  }

  async remove(userId: number, id: number) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    if (user?.role === 'ADMIN') {
      const deletedCategory = await this.prisma.categories.delete({
        where: { id },
      });

      await deleteCategoryIcon(category.icon);

      return deletedCategory;
    }

    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    if (category.is_system) {
      throw new ForbiddenException('Không thể xóa danh mục hệ thống');
    }

    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    const deletedCategory = await this.prisma.categories.delete({
      where: { id },
    });

    await deleteCategoryIcon(category.icon);

    return deletedCategory;
  }

  async uploadIcon(userId: number, id: number, file: Express.Multer.File) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    if (user?.role === 'ADMIN') {
      const iconPath = await saveCategoryIcon(file);
      const updatedCategory = await this.prisma.categories.update({
        where: { id },
        data: { icon: iconPath },
      });

      await deleteCategoryIcon(category.icon);

      return updatedCategory;
    }

    if (user?.role === 'BASIC') {
      throw new ForbiddenException('Không có quyền');
    }

    if (category.is_system) {
      throw new ForbiddenException('Không thể sửa danh mục hệ thống');
    }

    if (category.user_id !== userId) {
      throw new ForbiddenException('Không có quyền');
    }

    const iconPath = await saveCategoryIcon(file);
    const updatedCategory = await this.prisma.categories.update({
      where: { id },
      data: { icon: iconPath },
    });

    await deleteCategoryIcon(category.icon);

    return updatedCategory;
  }
}
