// Typed view of the suite brand file (mainfast/brand.json). Every package reads its names,
// check names, comment markers and action refs from here; none of them repeats a literal.
import brandJson from "../../../brand.json" with { type: "json" };

export type ProductSlug = "intact" | "migrations" | "rollcall" | "owners" | "evidence";
export const PRODUCT_SLUGS: readonly ProductSlug[] = ["intact", "migrations", "rollcall", "owners", "evidence"];

export interface SuiteBrand {
  name: string;
  version: string;
  author: string;
  copyrightYear: string;
  license: string;
  githubOrg: string;
  githubRepo: string;
  homepageUrl: string;
  docsUrl: string;
  issuesUrl: string;
  pricingUrl: string;
  /** The hosted GitHub App's install page. */
  appUrl: string;
  /** The App's dashboard, where Pro is bought. */
  dashboardUrl: string;
  npmScope: string;
  configFile: string;
  configFileAlt: string;
  schemaUrl: string;
  envPrefix: string;
  licenseEnv: string;
  plan: {
    freeActiveContributors: number;
    windowDays: number;
    proPricePerContributorMonth: string;
    /** Polar license-key benefit id per plan: `pro` is Mainfast Pro, `free` the optional free key. */
    benefitIds: { free: string; pro: string };
  };
  /** Polar's public license-key API (customer portal: no merchant secret). */
  polar: { api: string; organizationId: string; apiEnv: string; orgEnv: string; timeoutMs: number };
}

export interface ProductBrand {
  slug: ProductSlug;
  productName: string;
  tagline: string;
  description: string;
  npmName: string;
  cliName: string;
  configSection: ProductSlug;
  checkName: string;
  commentMarker: string;
  actionRef: string;
  branding: { icon: string; color: string };
  statusContext?: string;
  staleLabel?: string;
  /** Per-product docs link: <homepage>/tree/main/<slug>#readme. */
  docsUrl: string;
}

export const SUITE: SuiteBrand = brandJson.suite;

export function product(slug: ProductSlug): ProductBrand {
  const raw = (brandJson.products as Record<string, Omit<ProductBrand, "slug" | "docsUrl" | "configSection"> & { configSection: string }>)[slug];
  if (!raw) throw new Error(`brand.json has no product "${slug}"`);
  return {
    ...raw,
    slug,
    configSection: raw.configSection as ProductSlug,
    docsUrl: `${SUITE.homepageUrl}/tree/main/${slug}#readme`,
  };
}

export const PRODUCTS: readonly ProductBrand[] = PRODUCT_SLUGS.map(product);
