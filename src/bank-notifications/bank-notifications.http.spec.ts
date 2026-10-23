import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { sign } from 'jsonwebtoken';
import { JwtGuard } from '../auth/jwt.guard';
import { GeminiClient } from '../chatbot/gemini.client';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { FeaturesController } from '../features/features.controller';
import { PrismaService } from '../prisma/prisma.service';
import { BankNotificationExtractionService } from './bank-notification-extraction.service';
import { BankNotificationsController } from './bank-notifications.controller';

describe('bank extraction HTTP boundaries', () => {
  let app: INestApplication;
  let server: Server;
  let enabled: boolean;
  let respond: jest.Mock;
  let token: string;
  const savedSecret = process.env.JWT_SECRET;
  const body = {
    text: 'Ghi có +752.790 VND. Số dư 14.533.072 VND',
    consent: true,
  };

  beforeEach(async () => {
    enabled = true;
    process.env.JWT_SECRET = 'bank-http-test-secret';
    token = sign({ userId: 7 }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
    respond = jest.fn().mockResolvedValue({
      message: JSON.stringify({
        type: 'INCOME',
        amount: 752790,
        currency: 'VND',
        note: 'Nhận tiền',
        confidence: 0.99,
        evidence: 'Ghi có +752.790 VND',
      }),
    });
    const module = await Test.createTestingModule({
      controllers: [BankNotificationsController, FeaturesController],
      providers: [
        BankNotificationExtractionService,
        JwtGuard,
        {
          provide: FeatureFlagsService,
          useValue: {
            isBankNotificationAiEnabled: () => enabled,
            publicFlags: () => ({ bank_notification_ai: enabled }),
          },
        },
        { provide: GeminiClient, useValue: { respond } },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([
              {
                id: 7,
                email: 'bank-test@example.test',
                role: 'BASIC',
                is_active: true,
                deleted_at: null,
              },
            ]),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    server = app.getHttpServer() as Server;
  });
  afterEach(async () => {
    await app.close();
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
  });

  it('requires a valid session for both capabilities and extraction', async () => {
    await request(server).get('/features').expect(401);
    await request(server)
      .post('/bank-notifications/extract')
      .send(body)
      .expect(401);
    await request(server)
      .post('/bank-notifications/extract')
      .set('Authorization', 'Bearer invalid')
      .send(body)
      .expect(401);
    expect(respond).not.toHaveBeenCalled();
  });
  it('exposes only public flags and enforces the kill switch', async () => {
    enabled = false;
    const flags = await request(server)
      .get('/features')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(flags.body).toEqual({ bank_notification_ai: false });
    await request(server)
      .post('/bank-notifications/extract')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(503);
    expect(respond).not.toHaveBeenCalled();
  });
  it.each([
    { text: body.text },
    { ...body, consent: 'true' },
    { ...body, consent: false },
    { ...body, text: ['unexpected'] },
    { ...body, text: 'x'.repeat(801) },
  ])(
    'rejects malformed or unconsented requests before AI: %j',
    async (value) => {
      await request(server)
        .post('/bank-notifications/extract')
        .set('Authorization', `Bearer ${token}`)
        .send(value)
        .expect(400);
      expect(respond).not.toHaveBeenCalled();
    },
  );
  it('returns draft fields only, ignores write-oriented input and never claims screen visibility', async () => {
    const response = await request(server)
      .post('/bank-notifications/extract')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, wallet_id: 999, auto_save: true })
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'READY',
      amount: 752790,
      requires_confirmation: true,
      visibility_verified: false,
    });
    expect(response.body).not.toHaveProperty('wallet_id');
    expect(response.body).not.toHaveProperty('transaction_id');
    expect(JSON.stringify(respond.mock.calls)).not.toContain('14.533.072');
  });
});
