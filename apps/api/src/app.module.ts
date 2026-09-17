import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";

// Domain modules (auth, statements, transactions, categorization, analytics,
// insights, billing, organizations, admin) are added here starting Stage 4,
// each with an enforced boundary per docs/03-architecture.md. Only the health
// check exists at Stage 2 — this module deliberately proves the app boots
// against real config, not that any product feature works yet.
@Module({
  controllers: [HealthController],
})
export class AppModule {}
