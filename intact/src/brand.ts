// Every product name, org and URL comes from the suite's brand.json (mainfast/brand.json)
// through @mainfast/shared. Change them there, then `npm run brand:sync`.
import { product, SUITE } from "@mainfast/shared/brand";

export interface Brand {
  suiteName: string;
  productName: string;
  productSlug: string;
  cliName: string;
  configFile: string;
  configSection: string;
  checkName: string;
  commentMarker: string;
  githubOrg: string;
  githubRepo: string;
  homepageUrl: string;
  docsUrl: string;
  issuesUrl: string;
  actionRef: string;
  envPrefix: string;
  author: string;
}

const P = product("intact");

export const BRAND: Brand = {
  suiteName: SUITE.name,
  productName: P.productName,
  productSlug: P.slug,
  cliName: P.cliName,
  configFile: SUITE.configFile,
  configSection: P.configSection,
  checkName: P.checkName,
  commentMarker: P.commentMarker,
  githubOrg: SUITE.githubOrg,
  githubRepo: SUITE.githubRepo,
  homepageUrl: SUITE.homepageUrl,
  docsUrl: P.docsUrl,
  issuesUrl: SUITE.issuesUrl,
  actionRef: P.actionRef,
  envPrefix: SUITE.envPrefix,
  author: SUITE.author,
};

/** Name of an environment variable carrying the brand prefix, e.g. env("FORCE_STRATEGY"). */
export function envName(suffix: string): string {
  return `${BRAND.envPrefix}_${suffix}`;
}
