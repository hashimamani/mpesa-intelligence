import { Controller, Get, UseGuards } from "@nestjs/common";
import type { CategoryDTO } from "@mpesa/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CategoriesService } from "./categories.service";

@Controller("categories")
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  async list(): Promise<CategoryDTO[]> {
    return this.categories.list();
  }
}
