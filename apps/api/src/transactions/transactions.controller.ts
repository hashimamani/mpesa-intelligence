import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { categoryCorrectionSchema, type CategoryCorrectionInput } from "@mpesa/validation";
import type { TransactionDTO } from "@mpesa/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { TransactionsService } from "./transactions.service";

@Controller("transactions")
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post("category-corrections")
  async correctCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(categoryCorrectionSchema)) body: CategoryCorrectionInput,
  ): Promise<TransactionDTO> {
    return this.transactions.correctCategory({ ownerType: "user", ownerId: user.id }, body);
  }
}
