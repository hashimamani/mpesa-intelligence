import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { statementUploadSchema, type StatementUploadInput } from "@mpesa/validation";
import type { StatementDTO, StatementWithJobDTO, UploadUrlResponseDTO } from "@mpesa/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { StatementsService, type OwnerContext } from "./statements.service";

function ownerOf(user: AuthenticatedUser): OwnerContext {
  // Every statement is user-owned until Stage 12 adds organizations — this
  // is the one place that assumption lives, so Stage 12 only has to change it here.
  return { ownerType: "user", ownerId: user.id };
}

@Controller("statements")
@UseGuards(JwtAuthGuard)
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  @Post("upload-url")
  async requestUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    // Pipe scoped to this parameter specifically — a method-level @UsePipes()
    // would also run against @CurrentUser() (a CUSTOM-type param, subject to
    // pipes same as @Body()/@Query()/@Param()), validating the wrong object.
    // Real bug, found via the e2e test below, not just a style preference.
    @Body(new ZodValidationPipe(statementUploadSchema)) body: StatementUploadInput,
  ): Promise<UploadUrlResponseDTO> {
    return this.statements.requestUploadUrl(ownerOf(user), body);
  }

  @Post(":id/confirm")
  @HttpCode(200)
  async confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<StatementWithJobDTO> {
    return this.statements.confirmUpload(ownerOf(user), id);
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<StatementDTO[]> {
    return this.statements.listStatements(ownerOf(user));
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string): Promise<StatementWithJobDTO> {
    return this.statements.getStatement(ownerOf(user), id);
  }
}
