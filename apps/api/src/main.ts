import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadApiConfig } from "@mpesa/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Fail fast and loud if configuration is incomplete — never start the service
  // half-configured. See docs/05-security-threat-model.md and packages/config.
  const config = loadApiConfig();

  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(config.PORT);

  // eslint-disable-next-line no-console
  console.log(`API listening on port ${config.PORT} (${config.NODE_ENV})`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error during API startup:", error);
  process.exit(1);
});
