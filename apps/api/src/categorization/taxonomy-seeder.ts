import type { PrismaService } from "../prisma/prisma.service";
import { CATEGORY_TAXONOMY, SEED_MERCHANTS } from "./taxonomy";
import { normalizeMerchantName } from "./merchant-normalization";

/**
 * Idempotently upserts the category taxonomy and curated merchant list
 * (both keyed by a stable slug/normalizedName, not a generated id) so the
 * classifier always has categories to resolve against — no separate seed
 * step to remember to run before a deploy. Called at the start of every
 * processing job (statement-processor.ts); cheap (~20 category rows, ~10
 * merchant rows), and a no-op after the first run until the taxonomy or
 * seed list in taxonomy.ts actually changes.
 */
export async function ensureCategorizationDataSeeded(prisma: PrismaService): Promise<void> {
  const slugToId = new Map<string, string>();

  for (const top of CATEGORY_TAXONOMY) {
    const row = await prisma.category.upsert({
      where: { slug: top.slug },
      update: { name: top.name },
      create: { slug: top.slug, name: top.name, parentId: null },
    });
    slugToId.set(top.slug, row.id);
  }

  for (const top of CATEGORY_TAXONOMY) {
    for (const child of top.children ?? []) {
      const row = await prisma.category.upsert({
        where: { slug: child.slug },
        update: { name: child.name, parentId: slugToId.get(top.slug) },
        create: { slug: child.slug, name: child.name, parentId: slugToId.get(top.slug) },
      });
      slugToId.set(child.slug, row.id);
    }
  }

  for (const merchant of SEED_MERCHANTS) {
    const categoryId = slugToId.get(merchant.categorySlug);
    if (!categoryId) continue; // a typo in taxonomy.ts shouldn't crash a statement upload
    await prisma.merchant.upsert({
      where: { normalizedName: merchant.normalizedName },
      update: { canonicalName: merchant.canonicalName, defaultCategoryId: categoryId, source: "global" },
      create: {
        normalizedName: merchant.normalizedName,
        canonicalName: merchant.canonicalName,
        defaultCategoryId: categoryId,
        source: "global",
      },
    });
  }
}

/** Loads the full category table once per job, indexed both by slug (for
 * classifyByRule's output) and by id (for a Merchant/CategoryCorrection's
 * stored defaultCategoryId/newCategoryId) — classifier.ts's
 * resolveCategoryPair resolves either without a query per row. */
export async function loadCategoryLookup(prisma: PrismaService): Promise<CategoryLookup> {
  const rows = await prisma.category.findMany();
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return { bySlug, byId };
}

export interface CategoryLookup {
  bySlug: Map<string, { id: string; parentId: string | null }>;
  byId: Map<string, { id: string; parentId: string | null }>;
}
