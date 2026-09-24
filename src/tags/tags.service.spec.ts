import { TagsService } from './tags.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TagsService normalization', () => {
  it('never deletes a tag when database collation resolves the merge target to itself', async () => {
    const tags = {
      findFirst: jest.fn().mockResolvedValue({ id: 4, name: 'di chuyển' }),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    };
    const transaction_tags = { findMany: jest.fn(), deleteMany: jest.fn() };
    const db = {
      tags,
      transaction_tags,
      $transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn({ tags, transaction_tags }),
    };
    const service = new TagsService(db as unknown as PrismaService);
    await service.merge(7, 4, 'di chuyen');
    expect(tags.delete).not.toHaveBeenCalled();
    expect(transaction_tags.deleteMany).not.toHaveBeenCalled();
  });
  it('uses the same canonical transport tag for lookup and creation', async () => {
    const tags = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const service = new TagsService({ tags } as unknown as PrismaService);
    await service.create(7, '#  DI   CHUYỂN ');
    expect(tags.findFirst).toHaveBeenCalledWith({
      where: { name: 'di chuyển', user_id: 7 },
    });
    expect(tags.create).toHaveBeenCalledWith({
      data: { name: 'di chuyển', user_id: 7 },
    });
  });
});
