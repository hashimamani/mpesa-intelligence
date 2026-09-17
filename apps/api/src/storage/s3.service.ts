import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { loadApiConfig } from "@mpesa/config";

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export interface ObjectHead {
  sizeBytes: number;
  etag: string;
}

/**
 * Thin wrapper around the S3 SDK, pointed at MinIO locally (S3_ENDPOINT) and
 * real S3 in production — same client either way, per docs/07-ai-architecture.md's
 * provider-abstraction pattern applied to storage. Never exposes the bucket
 * publicly; every read/write goes through this service, never a raw bucket URL.
 */
@Injectable()
export class S3Service implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const config = loadApiConfig();
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      // MinIO needs path-style addressing (bucket.endpoint won't resolve for
      // a local hostname); real S3 works with either, so this is safe in prod too.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  /**
   * Only ever creates the bucket when it's genuinely missing (true for a
   * fresh local MinIO). Against real S3, the bucket already exists via
   * Terraform (see infrastructure/README.md) and the app's IAM role won't
   * have CreateBucket permission — that failure is caught and logged, not
   * fatal, since the assumption there is correct: the bucket exists.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created local bucket "${this.bucket}" (expected only against MinIO in development)`);
      } catch (createError) {
        this.logger.warn(
          `Could not create/verify bucket "${this.bucket}" — assuming it already exists (expected in production): ${String(createError)}`,
        );
      }
    }
  }

  async createPresignedUploadUrl(key: string, contentType: string): Promise<{ url: string; expiresAt: Date }> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const url = await getSignedUrl(this.client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
    return { url, expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000) };
  }

  /** Null if the object doesn't exist — the caller decides what that means (e.g. "upload never completed"). */
  async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        sizeBytes: result.ContentLength ?? 0,
        etag: (result.ETag ?? "").replaceAll('"', ""),
      };
    } catch {
      return null;
    }
  }

  /** Closes the underlying HTTP keep-alive connection pool — without this,
   * the AWS SDK v3 client can hold a process open past when everything else
   * is done (found via e2e tests hanging after their assertions completed). */
  onModuleDestroy(): void {
    this.client.destroy();
  }

  async getObjectBytes(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const byteArray = await result.Body?.transformToByteArray();
    if (!byteArray) throw new Error(`Object "${key}" has no body`);
    return Buffer.from(byteArray);
  }
}
