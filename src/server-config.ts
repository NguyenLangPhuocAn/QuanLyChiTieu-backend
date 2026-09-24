export function serverAddress(env: NodeJS.ProcessEnv = process.env) {
  const rawPort = env.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT phải là số nguyên từ 1 đến 65535.');
  }
  return { port, host: env.HOST?.trim() || '0.0.0.0' };
}
