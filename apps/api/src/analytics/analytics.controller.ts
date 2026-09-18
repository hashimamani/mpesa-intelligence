import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { SpendingSummaryDTO } from "@mpesa/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/jwt.strategy";
import { AnalyticsService } from "./analytics.service";

const DEFAULT_TREND_MONTHS = 6;

@Controller("analytics")
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("summary")
  async summary(@CurrentUser() user: AuthenticatedUser, @Query("month") month?: string): Promise<SpendingSummaryDTO> {
    return this.analytics.getSummary({ ownerType: "user", ownerId: user.id }, month);
  }

  @Get("trend")
  async trend(@CurrentUser() user: AuthenticatedUser, @Query("months") monthsParam?: string): Promise<SpendingSummaryDTO[]> {
    const months = monthsParam === undefined ? DEFAULT_TREND_MONTHS : Number(monthsParam);
    if (!Number.isFinite(months)) throw new BadRequestException("months must be a number");
    return this.analytics.getTrend({ ownerType: "user", ownerId: user.id }, months);
  }
}
