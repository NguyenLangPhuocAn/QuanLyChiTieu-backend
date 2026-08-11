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

  private deduplicateVisibleCategories<
    T extends {
      id: number;
      name: string;
      type: string;
      is_system?: boolean | null;
      user_id?: number | null;
    },
  >(categories: T[]) {
    const categoriesByKey = new Map<string, T>();

    for (const category of categories) {
      const scopeKey = category.is_system
        ? 'system'
        : `user:${category.user_id ?? 'none'}`;
      const key = `${scopeKey}:${category.type}:${category.name.trim().toLowerCase()}`;
      const existed = categoriesByKey.get(key);

      if (!existed || category.id < existed.id) {
        categoriesByKey.set(key, category);
      }
    }

    return Array.from(categoriesByKey.values()).sort(
      (left, right) => right.id - left.id,
    );
  }

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
    const isSystem = false;

    const existed = await this.prisma.categories.findFirst({
      where: isSystem
        ? {
            name,
            type: dto.type,
            is_system: true,
            OR: [{ is_active: true }, { is_active: null }],
          }
        : {
            name,
            type: dto.type,
            AND: [
              { OR: [{ is_active: true }, { is_active: null }] },
              { OR: [{ is_system: true }, { user_id: userId }] },
            ],
          },
    });

    if (existed) {
      throw new ForbiddenException('Danh mục đã tồn tại');
    }

    return this.prisma.categories.create({
      data: {
        name,
        type: dto.type,
        cash_flow_group: dto.cash_flow_group ?? 'NORMAL',
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
      const categories = await this.prisma.categories.findMany({
        where: {
          is_system: true,
          OR: [{ is_active: true }, { is_active: null }],
        },
        orderBy: { id: 'desc' },
      });

      return this.deduplicateVisibleCategories(categories);
    }

    if (user?.role === 'PREMIUM' || user?.role === 'ADMIN') {
      const categories = await this.prisma.categories.findMany({
        where: {
          AND: [
            { OR: [{ is_active: true }, { is_active: null }] },
            { OR: [{ is_system: true }, { user_id: userId }] },
          ],
        },
        orderBy: { id: 'desc' },
      });

      return this.deduplicateVisibleCategories(categories);
    }

    const categories = await this.prisma.categories.findMany({
      where: { OR: [{ is_active: true }, { is_active: null }] },
      orderBy: { id: 'desc' },
    });

    return this.deduplicateVisibleCategories(categories);
  }

  async update(userId: number, id: number, dto: UpdateCategoryDto) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    if (category.is_active === false) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    if (!dto.name && !dto.type && !dto.cash_flow_group) {
      throw new ForbiddenException('Không có dữ liệu để cập nhật');
    }

    const newName = dto.name?.trim().toLowerCase();
    const nextType = dto.type ?? category.type;

    if (newName) {
      const existed = await this.prisma.categories.findFirst({
        where: category.is_system
          ? {
              name: newName,
              type: nextType,
              is_system: true,
              OR: [{ is_active: true }, { is_active: null }],
              NOT: { id },
            }
          : {
              name: newName,
              type: nextType,
              AND: [
                { OR: [{ is_active: true }, { is_active: null }] },
                {
                  OR: [{ is_system: true }, { user_id: category.user_id }],
                },
              ],
              NOT: { id },
            },
      });

      if (existed) {
        throw new ForbiddenException('Danh mục đã tồn tại');
      }
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
        cash_flow_group: dto.cash_flow_group,
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

    if (category.is_active === false) {
      throw new NotFoundException('Danh mục không tồn tại');
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

    return this.prisma.categories.update({
      where: { id },
      data: {
        is_active: false,
        deleted_at: new Date(),
      },
    });
  }

  async uploadIcon(userId: number, id: number, file: Express.Multer.File) {
    const [category, user] = await Promise.all([
      this.prisma.categories.findUnique({ where: { id } }),
      this.prisma.users.findUnique({ where: { id: userId } }),
    ]);

    if (!category) {
      throw new NotFoundException('Danh mục không tồn tại');
    }

    if (category.is_active === false) {
      throw new NotFoundException('Danh mục không tồn tại');
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
