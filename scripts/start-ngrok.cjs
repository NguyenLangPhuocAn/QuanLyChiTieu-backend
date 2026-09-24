const ngrok = require('@ngrok/ngrok');

const port = Number(process.env.PORT || 3000);

if (!process.env.NGROK_AUTHTOKEN) {
  console.error('Thiếu NGROK_AUTHTOKEN trong biến môi trường.');
  process.exit(1);
}

let listener;

const shutdown = async () => {
  try {
    if (listener) await listener.close();
  } finally {
    process.exit(0);
  }
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

ngrok
  .forward({
    addr: port,
    authtoken_from_env: true,
  })
  .then(activeListener => {
    listener = activeListener;
    console.log(`NGROK_URL=${listener.url()}`);
    console.log(`FORWARDING_TO=http://localhost:${port}`);
    setInterval(() => undefined, 60_000);
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
