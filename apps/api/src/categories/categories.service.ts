import { Injectable } from "@nestjs/common";
import type { CategoryDTO } from "@mpesa/types";
import { PrismaService } from "../prisma/prisma.service";
import { ensureCategorizationDataSeeded } from "../categorization/taxonomy-seeder";

/**
 * Lists the full taxonomy (flat — parentId lets the client group top-level
 * categories from their subcategories) for the category-correction picker
 * (docs/01-prd.md's "Transaction list with manual category correction").
 * Not owner-scoped: the taxonomy is global, seeded once for everyone
 * (categorization/taxonomy.ts).
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CategoryDTO[]> {
    await ensureCategorizationDataSeeded(this.prisma);
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    });
    return categories.map((c) => ({ id: c.id, parentId: c.parentId, name: c.name, isActive: c.isActive }));
  }
}
