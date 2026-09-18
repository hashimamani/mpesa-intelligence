import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { StorageModule } from "./storage/storage.module";
import { QueueModule } from "./queue/queue.module";
import { AuthModule } from "./auth/auth.module";
import { StatementsModule } from "./statements/statements.module";
import { TransactionsModule } from "./transactions/transactions.module";

// Domain modules (analytics, insights, billing, organizations, admin) are
// added here in later stages, each with an enforced boundary per
// docs/03-architecture.md. Categorization (Stage 7) has no module of its
// own — it's pure logic invoked from statement-processor.ts, plus
// TransactionsModule's correction endpoint (layer 5).
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
    TransactionsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
