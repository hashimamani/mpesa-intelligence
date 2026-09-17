import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { StorageModule } from "./storage/storage.module";
import { QueueModule } from "./queue/queue.module";
import { AuthModule } from "./auth/auth.module";
import { StatementsModule } from "./statements/statements.module";

// Domain modules (transactions, categorization, analytics, insights,
// billing, organizations, admin) are added here in later stages, each with
// an enforced boundary per docs/03-architecture.md.
@Module({
  imports: [
    // Default rate limit for every route; auth endpoints tighten this
    // further with their own @Throttle() — see auth.controller.ts.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    StorageModule,
    QueueModule,
    AuthModule,
    StatementsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
