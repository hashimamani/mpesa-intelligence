import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Worker } from "bullmq";
import { loadApiConfig } from "@mpesa/config";
import { WorkerModule } from "./worker.module";
import { PrismaService } from "./prisma/prisma.service";
import { S3Service } from "./storage/s3.service";
import { STATEMENT_PROCESSING_QUEUE, type StatementProcessingJobData } from "./queue/statement-processing.queue";
import { createQueueRedisConnection } from "./queue/redis-connection";
import { processStatementJob } from "./statements/statement-processor";

async function bootstrap() {
  loadApiConfig(); // fail fast if misconfigured, same rule as main.ts

  const app = await NestFactory.createApplicationContext(WorkerModule);
  const prisma = app.get(PrismaService);
  const s3 = app.get(S3Service);

  const worker = new Worker<StatementProcessingJobData>(
    STATEMENT_PROCESSING_QUEUE,
    async (job) => {
      await processStatementJob({ prisma, s3 }, job.data.jobId);
    },
    { connection: createQueueRedisConnection(), concurrency: 4 },
  );

  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`Statement processing job ${job?.id} failed:`, err);
  });

  // eslint-disable-next-line no-console
  console.log("Statement processing worker started, listening on queue:", STATEMENT_PROCESSING_QUEUE);

  const shutdown = async () => {
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error during worker startup:", error);
  process.exit(1);
});
