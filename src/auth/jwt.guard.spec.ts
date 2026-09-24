import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwtGuard, type RequestWithUser } from './jwt.guard';
import { PrismaService } from '../prisma/prisma.service';

describe('JwtGuard', () => {
  const secret = 'jwt-guard-test-secret-for-local-tests-only';
  const originalSecret = process.env.JWT_SECRET;
  const query = jest.fn();
  const guard = new JwtGuard({ $queryRaw: query } as unknown as PrismaService);
  const account = {
    id: 7,
    email: 'test@example.test',
    role: 'BASIC',
    is_active: true,
    deleted_at: null,
  };
  const requestContext = (authorization?: string) => {
    const request = { headers: { authorization } } as RequestWithUser;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
    return { request, context };
  };
  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    query.mockReset().mockResolvedValue([account]);
  });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('loads current account permissions instead of trusting an old token role', async () => {
    const token = jwt.sign({ userId: 7, role: 'ADMIN' }, secret);
    const { context, request } = requestContext(`bearer ${token}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: 7,
      email: account.email,
      role: 'BASIC',
    });
  });

  it.each([undefined, '', 'Basic xyz', 'Bearer broken', 'Bearer one two'])(
    'returns 401 for malformed authorization without querying the database',
    async (authorization) => {
      await expect(
        guard.canActivate(requestContext(authorization).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('returns 401 for an expired token so the mobile client can refresh it', async () => {
    const token = jwt.sign({ userId: 7, exp: 1 }, secret);
    await expect(
      guard.canActivate(requestContext(`Bearer ${token}`).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['7', -1, 0, 1.5])(
    'rejects invalid user id %s before database lookup',
    async (userId) => {
      const token = jwt.sign({ userId }, secret);
      await expect(
        guard.canActivate(requestContext(`Bearer ${token}`).context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([
    { rows: [] },
    { rows: [{ ...account, is_active: false }] },
    { rows: [{ ...account, deleted_at: new Date() }] },
  ])('rejects missing, inactive or deleted accounts', async ({ rows }) => {
    query.mockResolvedValueOnce(rows);
    const token = jwt.sign({ userId: 7 }, secret);
    await expect(
      guard.canActivate(requestContext(`Bearer ${token}`).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns 503 for a database outage without attaching a user or leaking connection errors', async () => {
    query.mockRejectedValueOnce(
      new Error('private database connection detail'),
    );
    const token = jwt.sign({ userId: 7 }, secret);
    const { request, context } = requestContext(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 503,
      message: 'Chưa truy cập được dữ liệu tài khoản. Vui lòng thử lại sau.',
    });
    expect(request.user).toBeUndefined();
  });

  it('returns 503 when the server signing key is missing', async () => {
    delete process.env.JWT_SECRET;
    const { context } = requestContext('Bearer token');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
