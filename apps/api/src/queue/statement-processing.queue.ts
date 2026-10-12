import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { createQueueRedisConnection } from "./redis-connection";

export const STATEMENT_PROCESSING_QUEUE = "statement-processing";

export interface StatementProcessingJobData {
  statementId: string;
  jobId: string;
  /** Decryption password for a protected statement PDF. Transient by
   * design: it lives only in this job's payload until the worker has used
   * it once, is never written to the database or logs, and the job is
   * removed from Redis on completion/final failure (see enqueue()) so it
   * doesn't linger. Often a user's national ID number — treat as PII. */
  password?: string;
}

/**
 * Producer side only — the worker (apps/api/src/worker.ts) is a separate
 * process/entrypoint that consumes this queue, matching the eventual
 * production split (separate ECS service) described in docs/03-architecture.md,
 * even though both run from the same codebase today.
 */
@Injectable()
export class StatementProcessingQueue implements OnModuleDestroy {
  // Held onto explicitly (not just passed inline to `new Queue(...)`) because
  // BullMQ's queue.close() does not reliably close a connection it didn't
  // create itself — found via a real dangling-socket leak that hung the e2e
  // test process after all assertions had already passed.
  private readonly connection = createQueueRedisConnection();
  private readonly queue = new Queue<StatementProcessingJobData>(STATEMENT_PROCESSING_QUEUE, {
    connection: this.connection,
  });

  async enqueue(data: StatementProcessingJobData): Promise<void> {
    await this.queue.add("process", data, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      // The payload can carry a statement password — don't leave finished
      // jobs (and their data) sitting in Redis. The outcome of every run is
      // already recorded durably on StatementProcessingJob in Postgres, so
      // BullMQ's own job history adds nothing here.
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
