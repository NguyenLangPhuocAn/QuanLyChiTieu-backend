import { serverAddress } from './server-config';

describe('serverAddress', () => {
  it('keeps the existing LAN-accessible development port by default', () => {
    expect(serverAddress({})).toEqual({ host: '0.0.0.0', port: 3000 });
  });
  it('accepts a custom port and loopback-only host', () => {
    expect(serverAddress({ PORT: ' 8080 ', HOST: '127.0.0.1' })).toEqual({
      host: '127.0.0.1',
      port: 8080,
    });
  });
  it.each(['0', '-1', '65536', '3000x', '1.5', 'Infinity'])(
    'rejects invalid PORT %s',
    (PORT) => {
      expect(() => serverAddress({ PORT })).toThrow('PORT phải là số nguyên');
    },
  );
});
