import "reflect-metadata";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { loadApiConfig } from "@mpesa/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  // Fail fast and loud if configuration is incomplete — never start the service
  // half-configured. See docs/05-security-threat-model.md and packages/config.
  const config = loadApiConfig();

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  // credentials:true + an explicit origin (not "*") is required for the
  // httpOnly refresh-token cookie (see auth.controller.ts) to be sent
  // cross-origin from apps/web.
  app.enableCors({ origin: config.WEB_APP_URL, credentials: true });
  await app.listen(config.PORT);

  // eslint-disable-next-line no-console
  console.log(`API listening on port ${config.PORT} (${config.NODE_ENV})`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error during API startup:", error);
  process.exit(1);
});
