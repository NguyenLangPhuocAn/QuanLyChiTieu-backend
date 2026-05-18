import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TagsService {
  constructor(private prisma: PrismaService) {}

  private normalizeName(name?: string) {
    const normalized = name?.trim().replace(/^#+/, '').toLowerCase().slice(0, 50);

    if (!normalized) {
      throw new BadRequestException('Vui lòng nhập tên hashtag.');
    }

    return normalized;
  }

  private async withUsageCount(userId: number) {
    const tags = await this.prisma.tags.findMany({
      where: { user_id: userId },
      orderBy: { name: 'asc' },
    });
    const tagIds = tags.map((tag) => tag.id);
    const usageRows = tagIds.length
      ? await this.prisma.transaction_tags.groupBy({
          by: ['tag_id'],
          where: { tag_id: { in: tagIds } },
          _count: { transaction_id: true },
        })
      : [];
    const usageMap = new Map(
      usageRows.map((row) => [row.tag_id, row._count.transaction_id]),
    );

    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      user_id: tag.user_id,
      usage_count: usageMap.get(tag.id) ?? 0,
    }));
  }

  async findAll(userId: number) {
    return this.withUsageCount(userId);
  }

  async create(userId: number, name?: string) {
    const normalized = this.normalizeName(name);
    const existed = await this.prisma.tags.findFirst({
      where: { name: normalized, user_id: userId },
    });

    if (existed) {
      throw new ConflictException('Hashtag đã tồn tại.');
    }

    await this.prisma.tags.create({
      data: {
        name: normalized,
        user_id: userId,
      },
    });

    return this.withUsageCount(userId);
  }

  async update(userId: number, id: number, name?: string) {
    const normalized = this.normalizeName(name);
    const tag = await this.prisma.tags.findFirst({
      where: { id, user_id: userId },
    });

    if (!tag) {
      throw new NotFoundException('Hashtag không tồn tại.');
    }

    const existed = await this.prisma.tags.findFirst({
      where: {
        name: normalized,
        user_id: userId,
        NOT: { id },
      },
    });

    if (existed) {
      throw new ConflictException('Hashtag đã tồn tại.');
    }

    await this.prisma.tags.update({
      where: { id },
      data: { name: normalized },
    });

    return this.withUsageCount(userId);
  }

  async remove(userId: number, id: number) {
    const tag = await this.prisma.tags.findFirst({
      where: { id, user_id: userId },
    });

    if (!tag) {
      throw new NotFoundException('Hashtag không tồn tại.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.transaction_tags.deleteMany({
        where: { tag_id: id },
      });
      await tx.tags.delete({
        where: { id },
      });
    });

    return this.withUsageCount(userId);
  }

  async merge(userId: number, id: number, targetName?: string) {
    const normalizedTargetName = this.normalizeName(targetName);
    const sourceTag = await this.prisma.tags.findFirst({
      where: { id, user_id: userId },
    });

    if (!sourceTag) {
      throw new NotFoundException('Hashtag không tồn tại.');
    }

    if (sourceTag.name === normalizedTargetName) {
      return this.withUsageCount(userId);
    }

    await this.prisma.$transaction(async (tx) => {
      const targetTag =
        (await tx.tags.findFirst({
          where: { name: normalizedTargetName, user_id: userId },
        })) ??
        (await tx.tags.create({
          data: {
            name: normalizedTargetName,
            user_id: userId,
          },
        }));

      const sourceLinks = await tx.transaction_tags.findMany({
        where: { tag_id: id },
        select: { transaction_id: true },
      });

      for (const link of sourceLinks) {
        const existed = await tx.transaction_tags.findFirst({
          where: {
            transaction_id: link.transaction_id,
            tag_id: targetTag.id,
          },
        });

        if (!existed) {
          await tx.transaction_tags.create({
            data: {
              transaction_id: link.transaction_id,
              tag_id: targetTag.id,
            },
          });
        }
      }

      await tx.transaction_tags.deleteMany({
        where: { tag_id: id },
      });
      await tx.tags.delete({
        where: { id },
      });
    });

    return this.withUsageCount(userId);
  }
}
