import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validatePlanningItems } from './planning-validation';

type Row = { revision: number; payload: unknown; updated_at: Date };
export const stablePlanningJson = (value: unknown): string => {
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > 16)
      throw new BadRequestException('Bản lịch lồng quá nhiều lớp.');
    if (Array.isArray(v)) return v.map((item) => visit(item, depth + 1));
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, visit((v as Record<string, unknown>)[k], depth + 1)]),
      );
    return v;
  };
  return JSON.stringify(visit(value, 0));
};
export function validatePlanningPayload(value: unknown): string {
  const data = value as {
    version?: unknown;
    book?: {
      version?: unknown;
      bills?: unknown;
      periods?: unknown;
      suggestions?: unknown;
      reviewedAlerts?: unknown;
    };
    plans?: unknown;
  };
  const list = (v: unknown, max: number) => Array.isArray(v) && v.length <= max;
  if (
    !data ||
    data.version !== 1 ||
    !data.book ||
    data.book.version !== 1 ||
    !list(data.book.bills, 1000) ||
    !list(data.book.periods, 5000) ||
    !list(data.plans, 2000) ||
    (data.book.suggestions !== undefined &&
      !list(data.book.suggestions, 2000)) ||
    (data.book.reviewedAlerts !== undefined &&
      !list(data.book.reviewedAlerts, 2000)) ||
    Object.keys(data).some((k) => !['version', 'book', 'plans'].includes(k)) ||
    Object.keys(data.book).some(
      (k) =>
        ![
          'version',
          'bills',
          'periods',
          'suggestions',
          'reviewedAlerts',
        ].includes(k),
    )
  )
    throw new BadRequestException('Bản đồng bộ lịch chưa hợp lệ.');
  const text = stablePlanningJson(data);
  if (Buffer.byteLength(text, 'utf8') > 512 * 1024)
    throw new BadRequestException(
      'Bản lịch vượt 512 KB. Hãy lưu file trên máy.',
    );
  validatePlanningItems(data.book, data.plans);
  return text;
}
@Injectable()
export class PlanningSyncService {
  constructor(private readonly db: PrismaService) {}
  private response(row?: Row) {
    if (!row) return { revision: 0, snapshot: null, updatedAt: null };
    return {
      revision: row.revision,
      snapshot:
        typeof row.payload === 'string'
          ? (JSON.parse(row.payload) as unknown)
          : row.payload,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
  private unavailable(error: unknown): never {
    const e = error as { meta?: { code?: string } };
    if (e.meta?.code === '1146')
      throw new ServiceUnavailableException(
        'Máy chủ chưa triển khai đồng bộ lịch. Dữ liệu trên máy được giữ nguyên.',
      );
    throw error;
  }
  async get(userId: number) {
    try {
      const rows = await this.db.$queryRaw<
        Row[]
      >`SELECT revision,payload,updated_at FROM planning_snapshots WHERE user_id=${userId}`;
      return this.response(rows[0]);
    } catch (e) {
      return this.unavailable(e);
    }
  }
  async put(userId: number, body: unknown) {
    const input = body as { revision?: number; snapshot?: unknown };
    if (
      !input ||
      !Number.isSafeInteger(input.revision) ||
      Number(input.revision) < 0 ||
      Number(input.revision) >= 2147483647
    )
      throw new BadRequestException('Phiên bản lịch chưa hợp lệ.');
    const text = validatePlanningPayload(input.snapshot),
      expected = Number(input.revision);
    try {
      return await this.db.$transaction(async (tx) => {
        const changed =
          expected === 0
            ? await tx.$executeRaw`INSERT IGNORE INTO planning_snapshots (user_id,revision,payload,updated_at) VALUES (${userId},1,${text},UTC_TIMESTAMP(3))`
            : await tx.$executeRaw`UPDATE planning_snapshots SET revision=revision+1,payload=${text},updated_at=UTC_TIMESTAMP(3) WHERE user_id=${userId} AND revision=${expected}`;
        const rows = await tx.$queryRaw<
          Row[]
        >`SELECT revision,payload,updated_at FROM planning_snapshots WHERE user_id=${userId}`;
        const result = this.response(rows[0]);
        // Lost acknowledgements may retry the same snapshot safely.
        if (!changed && stablePlanningJson(result.snapshot) !== text)
          throw new ConflictException(
            'Lịch trên tài khoản vừa đổi. Hãy xem trước lại để chọn bản cần giữ.',
          );
        return result;
      });
    } catch (e) {
      return this.unavailable(e);
    }
  }
}
