import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto';
import { CreateWalletTransferDto } from './dto/create-wallet-transfer.dto';
import {
  AddSavingsContributionDto,
  WithdrawSavingsDto,
} from './dto/savings-entry.dto';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto';
import { buildSavingsRoadmap } from './savings-roadmap';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;
type GoalWithDetails = Prisma.savings_goalsGetPayload<{
  include: { wallet: true; entries: true };
}>;

@Injectable()
export class SavingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currencyService: CurrencyService,
  ) {}

  private money(value: string, label = 'Số tiền') {
    try {
      const amount = new Prisma.Decimal(value);
      if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
        throw new Error('non-positive');
      }
      return amount;
    } catch {
      throw new BadRequestException(`${label} không hợp lệ`);
    }
  }

  private date(value?: string) {
    return value ? new Date(value) : new Date();
  }

  private async ownedWallet(
    client: PrismaClientLike,
    userId: number,
    walletId: number,
  ) {
    const wallet = await client.wallets.findFirst({
      where: {
        id: walletId,
        user_id: userId,
        deleted_at: null,
        OR: [{ is_active: true }, { is_active: null }],
      },
    });

    if (!wallet) {
      throw new NotFoundException('Không tìm thấy ví');
    }

    return wallet;
  }

  private async ownedGoal(
    client: PrismaClientLike,
    userId: number,
    goalId: number,
  ) {
    const goal = await client.savings_goals.findFirst({
      where: { id: goalId, user_id: userId, deleted_at: null },
      include: { wallet: true, entries: { where: { deleted_at: null } } },
    });

    if (!goal) {
      throw new NotFoundException('Không tìm thấy mục tiêu tiết kiệm');
    }

    return goal;
  }

  private entryTotal(entries: Array<{ type: string; amount: Prisma.Decimal }>) {
    return entries.reduce((total, entry) => {
      const amount = new Prisma.Decimal(entry.amount);
      return entry.type === 'WITHDRAWAL'
        ? total.minus(amount)
        : total.plus(amount);
    }, new Prisma.Decimal(0));
  }

  private suggestedMonthly(
    targetAmount: number,
    currentAmount: number,
    targetDate?: Date | null,
  ) {
    const remaining = Math.max(0, targetAmount - currentAmount);
    if (!targetDate || remaining === 0) return 0;

    const now = new Date();
    const months = Math.max(
      1,
      (targetDate.getFullYear() - now.getFullYear()) * 12 +
        targetDate.getMonth() -
        now.getMonth() +
        1,
    );
    return Math.ceil((remaining / months) * 100) / 100;
  }

  private decorateGoal(goal: GoalWithDetails) {
    const current = this.entryTotal(goal.entries ?? []);
    const target = Number(goal.target_amount);
    const currentAmount = Number(current);
    const completed = goal.status === 'COMPLETED';
    const remaining = completed ? 0 : Math.max(0, target - currentAmount);
    const percent = completed
      ? 100
      : target > 0
        ? Math.min(100, Math.round((currentAmount / target) * 100))
        : 0;
    return {
      id: goal.id,
      user_id: goal.user_id,
      wallet_id: goal.wallet_id,
      wallet_name: goal.wallet?.name ?? null,
      wallet_currency: goal.wallet?.currency ?? 'VND',
      wallet_balance: Number(goal.wallet?.balance ?? 0),
      name: goal.name,
      target_amount: target,
      current_amount: currentAmount,
      roadmap: buildSavingsRoadmap({
        target_amount: target,
        current_amount: currentAmount,
        target_date: goal.target_date,
        status: goal.status,
        entries: (goal.entries ?? []).map((entry) => ({
          type: entry.type,
          amount: Number(entry.amount),
          entry_date: entry.entry_date,
        })),
      }),
      remaining_amount: remaining,
      progress_percent: percent,
      suggested_monthly: completed
        ? 0
        : this.suggestedMonthly(target, currentAmount, goal.target_date),
      target_date: goal.target_date,
      note: goal.note,
      status: goal.status,
      created_at: goal.created_at,
      updated_at: goal.updated_at,
      entries: [...(goal.entries ?? [])]
        .sort(
          (a, b) =>
            new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime(),
        )
        .map((entry) => ({
          id: entry.id,
          transfer_id: entry.transfer_id,
          type: entry.type,
          amount: Number(entry.amount),
          entry_date: entry.entry_date,
          note: entry.note,
          created_at: entry.created_at,
        })),
    };
  }

  private async createTransfer(
    tx: Prisma.TransactionClient,
    userId: number,
    input: {
      sourceWalletId: number;
      destinationWalletId: number;
      amount: Prisma.Decimal;
      transferDate: Date;
      note?: string;
      allowSavingsWallet: boolean;
    },
  ) {
    if (input.sourceWalletId === input.destinationWalletId) {
      throw new BadRequestException('Ví nguồn và ví nhận phải khác nhau');
    }

    const [source, destination] = await Promise.all([
      this.ownedWallet(tx, userId, input.sourceWalletId),
      this.ownedWallet(tx, userId, input.destinationWalletId),
    ]);

    if (
      !input.allowSavingsWallet &&
      (source.wallet_type === 'SAVINGS' ||
        destination.wallet_type === 'SAVINGS')
    ) {
      throw new BadRequestException(
        'Hãy đóng góp hoặc rút tiền ngay trong mục tiêu tiết kiệm',
      );
    }

    if (source.currency !== destination.currency) {
      throw new BadRequestException(
        'Bản đầu chỉ hỗ trợ chuyển giữa hai ví cùng loại tiền tệ',
      );
    }

    const debited = await tx.wallets.updateMany({
      where: {
        id: source.id,
        user_id: userId,
        currency: source.currency,
        balance: { gte: input.amount },
        deleted_at: null,
        OR: [{ is_active: true }, { is_active: null }],
      },
      data: { balance: { decrement: input.amount } },
    });

    if (debited.count !== 1) {
      throw new BadRequestException(
        'Số dư ví nguồn không đủ hoặc ví đã thay đổi. Vui lòng tải lại.',
      );
    }

    const credited = await tx.wallets.updateMany({
      where: {
        id: destination.id,
        user_id: userId,
        currency: destination.currency,
        deleted_at: null,
        OR: [{ is_active: true }, { is_active: null }],
      },
      data: { balance: { increment: input.amount } },
    });
    if (credited.count !== 1) {
      throw new BadRequestException(
        'Ví nhận không còn hoạt động hoặc đã đổi tiền tệ. Chưa thực hiện chuyển tiền.',
      );
    }

    return tx.wallet_transfers.create({
      data: {
        user_id: userId,
        source_wallet_id: source.id,
        destination_wallet_id: destination.id,
        amount: input.amount,
        currency: source.currency,
        transfer_date: input.transferDate,
        note: input.note?.trim() || null,
      },
    });
  }

  private async syncStatus(tx: Prisma.TransactionClient, goalId: number) {
    const goal = await tx.savings_goals.findUnique({
      where: { id: goalId },
      include: { entries: { where: { deleted_at: null } } },
    });
    if (!goal || goal.status === 'CANCELLED') return;

    const current = this.entryTotal(goal.entries);
    const status = current.greaterThanOrEqualTo(goal.target_amount)
      ? 'COMPLETED'
      : 'ACTIVE';
    if (status !== goal.status) {
      await tx.savings_goals.update({
        where: { id: goalId },
        data: { status },
      });
    }
  }

  async findAll(userId: number) {
    const goals = await this.prisma.savings_goals.findMany({
      where: { user_id: userId, deleted_at: null },
      include: { wallet: true, entries: { where: { deleted_at: null } } },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    });
    return goals.map((goal) => this.decorateGoal(goal));
  }

  async findOne(userId: number, goalId: number) {
    return this.decorateGoal(await this.ownedGoal(this.prisma, userId, goalId));
  }

  async getAssistantContext(userId: number) {
    const goals = await this.findAll(userId);
    const activeGoals = goals.filter((goal) => goal.status === 'ACTIVE');
    const currencySummaries = Array.from(
      activeGoals.reduce((summaries, goal) => {
        const currency = goal.wallet_currency;
        const current = summaries.get(currency) ?? {
          currency,
          target_amount: 0,
          saved_amount: 0,
          remaining_amount: 0,
          suggested_monthly: 0,
        };
        current.target_amount += goal.target_amount;
        current.saved_amount += goal.current_amount;
        current.remaining_amount += goal.remaining_amount;
        current.suggested_monthly += goal.suggested_monthly;
        summaries.set(currency, current);
        return summaries;
      }, new Map<string, { currency: string; target_amount: number; saved_amount: number; remaining_amount: number; suggested_monthly: number }>()),
    ).map(([, summary]) => summary);

    return {
      active_goal_count: activeGoals.length,
      completed_goal_count: goals.filter((goal) => goal.status === 'COMPLETED')
        .length,
      currency_summaries: currencySummaries,
      goals: activeGoals.slice(0, 5).map((goal) => ({
        id: goal.id,
        name: goal.name,
        progress_percent: goal.progress_percent,
        remaining_amount: goal.remaining_amount,
        suggested_monthly: goal.suggested_monthly,
        target_date: goal.target_date,
        currency: goal.wallet_currency,
      })),
    };
  }

  async createGoal(userId: number, dto: CreateSavingsGoalDto) {
    const name = dto.name.trim();
    if (!name)
      throw new BadRequestException('Tên mục tiêu không được để trống');

    const target = this.money(dto.target_amount, 'Số tiền mục tiêu');
    const initial = dto.initial_amount
      ? this.money(dto.initial_amount, 'Số tiền ban đầu')
      : null;
    const actor = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { role: true, currency_default: true },
    });
    if (!actor) throw new NotFoundException('Không tìm thấy người dùng');

    const existing = await this.prisma.savings_goals.findFirst({
      where: { user_id: userId, name, deleted_at: null },
    });
    if (existing) throw new BadRequestException('Tên mục tiêu đã tồn tại');

    if (actor.role === 'BASIC') {
      const activeCount = await this.prisma.savings_goals.count({
        where: {
          user_id: userId,
          deleted_at: null,
          status: 'ACTIVE',
        },
      });
      if (activeCount >= 1) {
        throw new BadRequestException(
          'Tài khoản BASIC chỉ được tạo 1 mục tiêu tiết kiệm',
        );
      }
    }

    const currency = this.currencyService.normalizeCurrency('VND');
    if (initial && !dto.source_wallet_id) {
      throw new BadRequestException(
        'Vui lòng chọn ví để trích khoản đóng góp ban đầu',
      );
    }
    const source = initial
      ? await this.ownedWallet(
          this.prisma,
          userId,
          dto.source_wallet_id as number,
        )
      : null;
    if (source?.wallet_type === 'SAVINGS') {
      throw new BadRequestException('Vui lòng chọn ví thường để trích tiền');
    }
    if (source && source.currency !== currency) {
      throw new BadRequestException('Khoản đóng góp ban đầu phải dùng ví VND');
    }

    const goalId = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallets.create({
        data: {
          user_id: userId,
          name: `Tiết kiệm - ${name}`.slice(0, 50),
          wallet_type: 'SAVINGS',
          currency,
          balance: new Prisma.Decimal(0),
        },
      });
      const goal = await tx.savings_goals.create({
        data: {
          user_id: userId,
          wallet_id: wallet.id,
          name,
          target_amount: target,
          target_date: dto.target_date ? new Date(dto.target_date) : null,
          note: dto.note?.trim() || null,
        },
      });

      if (initial && source) {
        const transfer = await this.createTransfer(tx, userId, {
          sourceWalletId: source.id,
          destinationWalletId: wallet.id,
          amount: initial,
          transferDate: new Date(),
          note: `Đóng góp ban đầu cho ${name}`,
          allowSavingsWallet: true,
        });
        await tx.savings_goal_entries.create({
          data: {
            goal_id: goal.id,
            transfer_id: transfer.id,
            type: 'CONTRIBUTION',
            amount: initial,
            entry_date: new Date(),
            note: dto.note?.trim() || null,
          },
        });
        await this.syncStatus(tx, goal.id);
      }
      return goal.id;
    });

    return this.findOne(userId, goalId);
  }

  async updateGoal(userId: number, goalId: number, dto: UpdateSavingsGoalDto) {
    const goal = await this.ownedGoal(this.prisma, userId, goalId);
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) {
      throw new BadRequestException('Tên mục tiêu không được để trống');
    }
    if (name && name !== goal.name) {
      const duplicate = await this.prisma.savings_goals.findFirst({
        where: { user_id: userId, name, deleted_at: null, NOT: { id: goalId } },
      });
      if (duplicate) throw new BadRequestException('Tên mục tiêu đã tồn tại');
    }
    const target = dto.target_amount
      ? this.money(dto.target_amount, 'Số tiền mục tiêu')
      : undefined;
    if (
      name === undefined &&
      target === undefined &&
      dto.target_date === undefined &&
      dto.note === undefined
    ) {
      throw new BadRequestException('Không có dữ liệu để cập nhật');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.savings_goals.update({
        where: { id: goalId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(target !== undefined ? { target_amount: target } : {}),
          ...(dto.target_date !== undefined
            ? {
                target_date: dto.target_date ? new Date(dto.target_date) : null,
              }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
        },
      });
      if (name !== undefined) {
        await tx.wallets.update({
          where: { id: goal.wallet_id },
          data: { name: `Tiết kiệm - ${name}`.slice(0, 50) },
        });
      }
      if (target !== undefined) {
        await this.syncStatus(tx, goalId);
      }
    });
    return this.findOne(userId, goalId);
  }

  async removeGoal(userId: number, goalId: number) {
    const goal = await this.ownedGoal(this.prisma, userId, goalId);
    if (new Prisma.Decimal(goal.wallet.balance ?? 0).greaterThan(0)) {
      throw new BadRequestException(
        'Vui lòng rút hết tiền trước khi xóa mục tiêu',
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const archived = await tx.wallets.updateMany({
        where: {
          id: goal.wallet_id,
          user_id: userId,
          deleted_at: null,
          balance: { equals: 0 },
        },
        data: { is_active: false, deleted_at: now },
      });
      if (archived.count !== 1) {
        throw new BadRequestException(
          'Số dư đã thay đổi. Vui lòng tải lại và rút hết tiền trước khi xóa mục tiêu.',
        );
      }
      await tx.savings_goals.update({
        where: { id: goalId },
        data: { status: 'CANCELLED', deleted_at: now },
      });
    });
    return { message: 'Đã xóa mục tiêu tiết kiệm' };
  }

  async contribute(
    userId: number,
    goalId: number,
    dto: AddSavingsContributionDto,
  ) {
    const amount = this.money(dto.amount, 'Số tiền đóng góp');
    const goal = await this.ownedGoal(this.prisma, userId, goalId);
    if (goal.status === 'COMPLETED') {
      throw new BadRequestException(
        'Mục tiêu đã hoàn thành. Hãy tăng số tiền mục tiêu trước khi đóng góp thêm',
      );
    }
    const source = await this.ownedWallet(
      this.prisma,
      userId,
      dto.source_wallet_id,
    );
    if (source.wallet_type === 'SAVINGS') {
      throw new BadRequestException('Vui lòng chọn ví thường làm ví nguồn');
    }

    await this.prisma.$transaction(async (tx) => {
      const transfer = await this.createTransfer(tx, userId, {
        sourceWalletId: source.id,
        destinationWalletId: goal.wallet_id,
        amount,
        transferDate: this.date(dto.entry_date),
        note: dto.note || `Đóng góp cho ${goal.name}`,
        allowSavingsWallet: true,
      });
      await tx.savings_goal_entries.create({
        data: {
          goal_id: goalId,
          transfer_id: transfer.id,
          type: 'CONTRIBUTION',
          amount,
          entry_date: this.date(dto.entry_date),
          note: dto.note?.trim() || null,
        },
      });
      await this.syncStatus(tx, goalId);
    });
    return this.findOne(userId, goalId);
  }

  async withdraw(userId: number, goalId: number, dto: WithdrawSavingsDto) {
    const amount = this.money(dto.amount, 'Số tiền rút');
    const goal = await this.ownedGoal(this.prisma, userId, goalId);
    const current = this.entryTotal(goal.entries);
    if (current.lessThan(amount)) {
      throw new BadRequestException('Số tiền rút vượt quá tiến độ hiện tại');
    }
    const destination = await this.ownedWallet(
      this.prisma,
      userId,
      dto.destination_wallet_id,
    );
    if (destination.wallet_type === 'SAVINGS') {
      throw new BadRequestException('Vui lòng chọn ví thường để nhận tiền');
    }

    await this.prisma.$transaction(async (tx) => {
      const transfer = await this.createTransfer(tx, userId, {
        sourceWalletId: goal.wallet_id,
        destinationWalletId: destination.id,
        amount,
        transferDate: this.date(dto.entry_date),
        note: dto.note || `Rút từ ${goal.name}`,
        allowSavingsWallet: true,
      });
      await tx.savings_goal_entries.create({
        data: {
          goal_id: goalId,
          transfer_id: transfer.id,
          type: 'WITHDRAWAL',
          amount,
          entry_date: this.date(dto.entry_date),
          note: dto.note?.trim() || null,
        },
      });
    });
    return this.findOne(userId, goalId);
  }

  async transferBetweenWallets(userId: number, dto: CreateWalletTransferDto) {
    const amount = this.money(dto.amount, 'Số tiền chuyển');
    const transfer = await this.prisma.$transaction((tx) =>
      this.createTransfer(tx, userId, {
        sourceWalletId: dto.source_wallet_id,
        destinationWalletId: dto.destination_wallet_id,
        amount,
        transferDate: this.date(dto.transfer_date),
        note: dto.note,
        allowSavingsWallet: false,
      }),
    );
    return { ...transfer, amount: Number(transfer.amount) };
  }

  async findTransfers(userId: number) {
    const transfers = await this.prisma.wallet_transfers.findMany({
      where: { user_id: userId, deleted_at: null },
      include: {
        source_wallet: { select: { id: true, name: true, wallet_type: true } },
        destination_wallet: {
          select: { id: true, name: true, wallet_type: true },
        },
        goal_entry: { select: { goal_id: true, type: true } },
      },
      orderBy: [{ transfer_date: 'desc' }, { id: 'desc' }],
    });
    return transfers.map((transfer) => ({
      ...transfer,
      amount: Number(transfer.amount),
      kind: transfer.goal_entry ? 'SAVINGS' : 'TRANSFER',
    }));
  }
}
