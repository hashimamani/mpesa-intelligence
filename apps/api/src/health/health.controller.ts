import { Controller, Get } from "@nestjs/common";
import { Client } from "pg";
import Redis from "ioredis";
import { loadApiConfig } from "@mpesa/config";

interface HealthCheckResult {
  status: "ok" | "degraded";
  checks: Record<string, "ok" | "unreachable">;
}

/**
 * Real connectivity checks against Postgres and Redis — not a hardcoded "ok".
 * This is what CI/CD and CloudWatch synthetic checks hit post-deploy
 * (see docs/09-testing-deployment-strategy.md).
 */
@Controller("health")
export class HealthController {
  @Get()
  async check(): Promise<HealthCheckResult> {
    const config = loadApiConfig();
    const checks: HealthCheckResult["checks"] = {
      database: await this.checkDatabase(config.DATABASE_URL),
      redis: await this.checkRedis(config.REDIS_URL),
    };

    const status = Object.values(checks).every((c) => c === "ok") ? "ok" : "degraded";
    return { status, checks };
  }

  private async checkDatabase(connectionString: string): Promise<"ok" | "unreachable"> {
    const client = new Client({ connectionString, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return "ok";
    } catch {
      return "unreachable";
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async checkRedis(url: string): Promise<"ok" | "unreachable"> {
    const redis = new Redis(url, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0 });
    try {
      await redis.connect();
      await redis.ping();
      return "ok";
    } catch {
      return "unreachable";
    } finally {
      redis.disconnect();
    }
  }
}
