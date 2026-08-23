import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { isOfflineTestMode } from './agent/offline-runtime.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const host = process.env.BOB_HOST || '127.0.0.1';
  const port = Number(process.env.BOB_PORT || 5556);
  const allowedOrigins = (
    process.env.BOB_ALLOWED_ORIGINS ||
    'http://127.0.0.1:5555,http://localhost:5555'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  app.setGlobalPrefix('api');

  await app.listen(port, host);
  console.log(`Bob server running on http://${host}:${port}`);
  if (isOfflineTestMode()) {
    console.warn('BOB_TEST_MODE=offline: external models and speech binaries are disabled.');
  }
}
bootstrap();
