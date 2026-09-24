import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GoogleController } from './google.controller';
import { UsersService } from '../users/users.service';

describe('GoogleController token verification', () => {
  const keys = [
    'GOOGLE_WEB_CLIENT_ID',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_ANDROID_CLIENT_ID',
    'GOOGLE_IOS_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'WEB_ADMIN_URL',
  ] as const;
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  const users = {
    loginMobileWithGoogle: jest.fn(),
    loginWithGoogle: jest.fn(),
  };
  const controller = new GoogleController(users as unknown as UsersService);
  const profile = {
    aud: 'our-web-client',
    sub: 'google-user',
    email: 'test@example.test',
    email_verified: true,
    name: 'Test',
  };
  const response = (body: unknown, status = 200) =>
    ({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    }) as Response;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    keys.forEach((key) => {
      delete process.env[key];
    });
    process.env.GOOGLE_WEB_CLIENT_ID = 'our-web-client';
    process.env.WEB_ADMIN_URL = 'https://admin.example.test';
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(profile));
    users.loginMobileWithGoogle.mockResolvedValue({ accessToken: 'app-token' });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(() => {
    keys.forEach((key) => {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    });
  });

  it.each([true, 'true'])(
    'accepts an explicitly verified email (%s) for this app',
    async (verified) => {
      fetchMock.mockResolvedValueOnce(
        response({ ...profile, email_verified: verified }),
      );
      await expect(controller.googleMobile('test-token')).resolves.toEqual({
        accessToken: 'app-token',
      });
      expect(users.loginMobileWithGoogle).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'google-user',
          email: 'test@example.test',
        }),
      );
    },
  );

  it('does not contact Google or create an account when no audience is configured', async () => {
    delete process.env.GOOGLE_WEB_CLIENT_ID;
    await expect(controller.googleMobile('test-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(users.loginMobileWithGoogle).not.toHaveBeenCalled();
  });

  it.each([false, 'false', undefined, null, 0])(
    'rejects an email that was not explicitly verified (%s)',
    async (verified) => {
      fetchMock.mockResolvedValueOnce(
        response({ ...profile, email_verified: verified }),
      );
      await expect(
        controller.googleMobile('test-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.loginMobileWithGoogle).not.toHaveBeenCalled();
    },
  );

  it.each(['another-client', undefined])(
    'rejects an unrecognized or missing audience (%s)',
    async (aud) => {
      fetchMock.mockResolvedValueOnce(response({ ...profile, aud }));
      await expect(
        controller.googleMobile('test-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.loginMobileWithGoogle).not.toHaveBeenCalled();
    },
  );

  it.each([429, 503])(
    'returns service unavailable for Google HTTP %s',
    async (status) => {
      fetchMock.mockResolvedValueOnce(response({}, status));
      await expect(
        controller.googleMobile('test-token'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(users.loginMobileWithGoogle).not.toHaveBeenCalled();
    },
  );

  it('hides connection details when Google cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private transport details'));
    await expect(controller.googleMobile('test-token')).rejects.toMatchObject({
      status: 503,
      message:
        'Chưa kết nối được dịch vụ đăng nhập Google. Vui lòng thử lại sau.',
    });
  });

  it('checks the exact web OAuth client after exchanging a web authorization code', async () => {
    process.env.GOOGLE_CLIENT_ID = 'web-callback-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    fetchMock
      .mockResolvedValueOnce(response({ id_token: 'test-id-token' }))
      .mockResolvedValueOnce(response(profile));
    const result = await controller.googleCallback('test-code');
    expect(new URL(result.url).searchParams.get('googleError')).toBe(
      'Google client ID không khớp cấu hình',
    );
    expect(users.loginWithGoogle).not.toHaveBeenCalled();
  });
});
