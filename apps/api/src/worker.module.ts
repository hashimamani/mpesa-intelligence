import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { StorageModule } from "./storage/storage.module";

// A separate, HTTP-less application context — the worker process. Matches
// the eventual production split (a distinct ECS service, docs/03-architecture.md)
// even though it runs from the same codebase as the API today. Only needs
// what statement processing needs: Prisma and S3, not auth/throttling/HTTP.
@Module({
  imports: [PrismaModule, StorageModule],
})
export class WorkerModule {}
