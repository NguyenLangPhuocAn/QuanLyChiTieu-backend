import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { BudgetsService } from '../budgets/budgets.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateBroadcastDto,
  NotificationSeverity,
} from './dto/create-broadcast.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

type NotificationType =
  | 'BUDGET_WARNING'
  | 'BUDGET_EXCEEDED'
  | 'BUDGET_EXPIRING'
  | 'SYSTEM';

type CreateForUserInput = {
  userId: number;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  sourceType?: string;
  sourceId?: number;
  dedupeKey: string;
  broadcastId?: number;
};

type ListQuery = {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
};

type NotificationCreateClient = Pick<PrismaService, 'notifications'>;
type NotificationTransactionClient = NotificationCreateClient &
  Pick<PrismaService, 'admin_logs' | '$executeRaw' | '$queryRaw'>;

type BudgetAlertView = {
  id: number;
  name: string;
  wallet_name: string;
  limit_amount: number;
  available_limit_amount: number;
  spent: number;
  status: 'NORMAL' | 'WARNING' | 'EXCEEDED';
  start_date: Date | string;
  end_date: Date | string;
};

type ExpiringBudgetRow = {
  id: number;
  user_id: number;
  name: string;
  wallet_name: string;
  end_date: Date | string;
};

type BroadcastListRow = {
  id: number;
  admin_id: number | null;
  title: string;
  message: string;
  severity: NotificationSeverity;
  created_at: Date | null;
  revoked_at: Date | null;
};

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    @Optional() private budgetsService?: BudgetsService,
  ) {}

  private normalizePage(page?: number) {
    const value = Number(page ?? 1);

    if (!Number.isFinite(value) || value < 1) {
      return 1;
    }

    return Math.floor(value);
  }

  private normalizeLimit(limit?: number, defaultLimit = 20) {
    const value = Number(limit ?? defaultLimit);

    if (!Number.isFinite(value) || value < 1) {
      return defaultLimit;
    }

    return Math.min(50, Math.floor(value));
  }

  private isDuplicateWrite(error: unknown) {
    return (
      error instanceof PrismaClientKnownRequestError && error.code === 'P2002'
    );
  }

  private toNumber(value: Prisma.Decimal | string | number) {
    return Number(value);
  }

  private formatDateKey(value: Date | string) {
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');

      return `${year}-${month}-${day}`;
    }

    return value.slice(0, 10);
  }

  async getSettings(userId: number) {
    const existing = await this.prisma.notification_settings.findUnique({
      where: { user_id: userId },
    });

    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.notification_settings.create({
        data: {
          user_id: userId,
          budget_alerts_enabled: true,
          budget_expiring_enabled: true,
          system_notifications_enabled: true,
        },
      });
    } catch (error) {
      if (!this.isDuplicateWrite(error)) {
        throw error;
      }

      const racedSettings = await this.prisma.notification_settings.findUnique({
        where: { user_id: userId },
      });

      if (racedSettings) {
        return racedSettings;
      }

      throw error;
    }
  }

  async updateSettings(userId: number, dto: UpdateNotificationSettingsDto) {
    await this.getSettings(userId);

    return this.prisma.notification_settings.update({
      where: { user_id: userId },
      data: {
        ...(dto.budget_alerts_enabled !== undefined
          ? { budget_alerts_enabled: dto.budget_alerts_enabled }
          : {}),
        ...(dto.budget_expiring_enabled !== undefined
          ? { budget_expiring_enabled: dto.budget_expiring_enabled }
          : {}),
        ...(dto.system_notifications_enabled !== undefined
          ? { system_notifications_enabled: dto.system_notifications_enabled }
          : {}),
      },
    });
  }

  async list(userId: number, query: ListQuery = {}) {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const where: Prisma.notificationsWhereInput = {
      user_id: userId,
      deleted_at: null,
      ...(query.unreadOnly ? { read_at: null } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.notifications.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notifications.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async unreadCount(userId: number) {
    const count = await this.prisma.notifications.count({
      where: {
        user_id: userId,
        deleted_at: null,
        read_at: null,
      },
    });

    return { count };
  }

  async markRead(userId: number, id: number) {
    const result = await this.prisma.notifications.updateMany({
      where: { id, user_id: userId, deleted_at: null },
      data: { read_at: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('Không tìm thấy thông báo');
    }

    return { message: 'Đã đánh dấu đã đọc' };
  }

  async markAllRead(userId: number) {
    await this.prisma.notifications.updateMany({
      where: { user_id: userId, deleted_at: null, read_at: null },
      data: { read_at: new Date() },
    });

    return { message: 'Đã đánh dấu tất cả là đã đọc' };
  }

  async deleteOne(userId: number, id: number) {
    const result = await this.prisma.notifications.updateMany({
      where: { id, user_id: userId, deleted_at: null },
      data: { deleted_at: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('Không tìm thấy thông báo');
    }

    return { message: 'Đã xóa thông báo' };
  }

  async createForUser(
    input: CreateForUserInput,
    client: NotificationCreateClient = this.prisma,
  ) {
    try {
      return await client.notifications.create({
        data: {
          user_id: input.userId,
          broadcast_id: input.broadcastId,
          type: input.type,
          severity: input.severity,
          title: input.title,
          message: input.message,
          source_type: input.sourceType,
          source_id: input.sourceId,
          dedupe_key: input.dedupeKey,
        },
      });
    } catch (error) {
      if (this.isDuplicateWrite(error)) {
        return null;
      }

      throw error;
    }
  }

  async createBudgetAlertsForWallet(userId: number, walletId: number) {
    const settings = await this.getSettings(userId);

    if (settings.budget_alerts_enabled === false) {
      return { scannedCount: 0, createdCount: 0 };
    }

    if (!this.budgetsService) {
      return { scannedCount: 0, createdCount: 0 };
    }

    const now = new Date();
    const budgets = (
      (await this.budgetsService.findAll(userId, walletId)) as BudgetAlertView[]
    ).filter(
      (budget) =>
        new Date(budget.start_date) <= now && new Date(budget.end_date) >= now,
    );

    let createdCount = 0;

    for (const budget of budgets) {
      if (budget.status === 'NORMAL') {
        continue;
      }

      const endDateKey = this.formatDateKey(budget.end_date);
      const isExceeded = budget.status === 'EXCEEDED';

      const created = await this.createForUser({
        userId,
        type: isExceeded ? 'BUDGET_EXCEEDED' : 'BUDGET_WARNING',
        severity: isExceeded ? 'CRITICAL' : 'WARNING',
        title: isExceeded ? 'Vượt ngân sách' : 'Cảnh báo ngân sách',
        message: isExceeded
          ? `${budget.name} trong ${budget.wallet_name} đã vượt ngân sách.`
          : `${budget.name} trong ${budget.wallet_name} đã đạt 80% ngân sách.`,
        sourceType: 'budget',
        sourceId: budget.id,
        dedupeKey: isExceeded
          ? `budget-exceeded:${budget.id}:${endDateKey}`
          : `budget-warning:${budget.id}:${endDateKey}:80`,
      });

      if (created) {
        createdCount += 1;
      }
    }

    return { scannedCount: budgets.length, createdCount };
  }

  async createExpiringBudgetNotifications() {
    const budgets = await this.prisma.$queryRaw<ExpiringBudgetRow[]>`
      SELECT b.id, b.user_id, b.name, w.name AS wallet_name, b.end_date
      FROM budgets b
      INNER JOIN users u ON u.id = b.user_id
      INNER JOIN wallets w ON w.id = b.wallet_id
      LEFT JOIN notification_settings ns ON ns.user_id = b.user_id
      WHERE COALESCE(u.is_active, 1) = 1
        AND w.user_id = b.user_id
        AND COALESCE(b.is_active, 1) = 1
        AND COALESCE(w.is_active, 1) = 1
        AND COALESCE(ns.budget_expiring_enabled, 1) = 1
        AND (
          (b.period = 'WEEK' AND DATE(b.end_date) = DATE_ADD(CURDATE(), INTERVAL 1 DAY))
          OR (b.period = 'MONTH' AND DATE(b.end_date) = DATE_ADD(CURDATE(), INTERVAL 3 DAY))
          OR (b.period = 'QUARTER' AND DATE(b.end_date) = DATE_ADD(CURDATE(), INTERVAL 7 DAY))
          OR (b.period = 'YEAR' AND DATE(b.end_date) = DATE_ADD(CURDATE(), INTERVAL 7 DAY))
        )
    `;

    let createdCount = 0;

    for (const budget of budgets) {
      const endDateKey = this.formatDateKey(budget.end_date);
      const created = await this.createForUser({
        userId: budget.user_id,
        type: 'BUDGET_EXPIRING',
        severity: 'WARNING',
        title: 'Ngân sách sắp hết hạn',
        message: `${budget.name} trong ${budget.wallet_name} sẽ hết hạn vào ${endDateKey}.`,
        sourceType: 'budget',
        sourceId: budget.id,
        dedupeKey: `budget-expiring:${budget.id}:${endDateKey}`,
      });

      if (created) {
        createdCount += 1;
      }
    }

    return { scannedCount: budgets.length, createdCount };
  }

  async createBroadcast(adminId: number, dto: CreateBroadcastDto) {
    const title = dto.title.trim();
    const message = dto.message.trim();
    const severity = dto.severity ?? 'INFO';

    const existing = await this.prisma.notification_broadcasts.findFirst({
      where: { title, message },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'Thông báo có cùng tiêu đề và nội dung đã tồn tại.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const broadcast = await tx.notification_broadcasts.create({
        data: { admin_id: adminId, title, message, severity },
      });
      const users = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT u.id FROM users u LEFT JOIN notification_settings ns ON ns.user_id = u.id WHERE COALESCE(u.is_active, 1) = 1 AND COALESCE(ns.system_notifications_enabled, 1) = 1
      `;

      let recipientCount = 0;
      for (const user of users) {
        const created = await this.createForUser(
          {
            userId: user.id,
            broadcastId: broadcast.id,
            type: 'SYSTEM',
            severity,
            title,
            message,
            sourceType: 'broadcast',
            sourceId: broadcast.id,
            dedupeKey: `broadcast:${broadcast.id}`,
          },
          tx,
        );

        if (created) {
          recipientCount += 1;
        }
      }

      await tx.admin_logs.create({
        data: {
          admin_id: adminId,
          action: `Admin gửi thông báo hệ thống (id: ${broadcast.id})`,
        },
      });

      return { ...broadcast, recipientCount };
    });
  }

  async recallBroadcast(adminId: number, id: number) {
    return this.prisma.$transaction(
      async (tx: NotificationTransactionClient) => {
        const rows = await tx.$queryRaw<
          Array<{ id: number; revoked_at: Date | null }>
        >`
        SELECT id, revoked_at
        FROM notification_broadcasts
        WHERE id = ${id}
        LIMIT 1
      `;
        const broadcast = rows[0];

        if (!broadcast) {
          throw new NotFoundException('Không tìm thấy thông báo đồng bộ');
        }

        if (broadcast.revoked_at) {
          return {
            message: 'Thông báo đã được thu hồi trước đó.',
            revokedCount: 0,
          };
        }

        await tx.$executeRaw`
        UPDATE notification_broadcasts
        SET revoked_at = NOW()
        WHERE id = ${id} AND revoked_at IS NULL
      `;
        const result = await tx.notifications.updateMany({
          where: { broadcast_id: id, deleted_at: null },
          data: { deleted_at: new Date() },
        });

        await tx.admin_logs.create({
          data: {
            admin_id: adminId,
            action: `Admin thu hồi thông báo hệ thống (id: ${id})`,
          },
        });

        return {
          message: 'Đã thu hồi thông báo.',
          revokedCount: result.count,
        };
      },
    );
  }

  async listBroadcasts(query: { page?: number; limit?: number } = {}) {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit, 10);
    const offset = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.$queryRaw<BroadcastListRow[]>`
        SELECT id, admin_id, title, message, severity, created_at, revoked_at
        FROM notification_broadcasts
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.notification_broadcasts.count(),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
