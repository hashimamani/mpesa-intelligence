import { Global, Module } from "@nestjs/common";
import { StatementProcessingQueue } from "./statement-processing.queue";

@Global()
@Module({
  providers: [StatementProcessingQueue],
  exports: [StatementProcessingQueue],
})
export class QueueModule {}
