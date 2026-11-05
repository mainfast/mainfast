/**
 * Brand, org and URL strings for Evidence, all read from the suite's brand.json
 * (mainfast/brand.json) through @mainfast/shared.
 * Change them there and run `npm run brand:sync` at the suite root.
 */
import { product, SUITE } from "@mainfast/shared/brand";
import { DEFAULT_API_URL, GITHUB_API_VERSION } from "@mainfast/shared/github";
import pkg from "../package.json" with { type: "json" };

const P = product("evidence");

export const SUITE_NAME = SUITE.name;
export const PRODUCT_NAME = P.productName;
export const PRODUCT_SLUG = P.slug;
export const CLI_NAME = P.cliName;
export const VERSION: string = pkg.version;
export const CONFIG_FILE = SUITE.configFile;
export const CONFIG_SECTION = P.configSection;
/** Name of the check run this tool creates. Excluded when judging other checks. */
export const CHECK_NAME = P.checkName;
/** Hidden marker that identifies the sticky PR comment. */
export const COMMENT_MARKER = P.commentMarker;
export const GITHUB_ORG = SUITE.githubOrg;
export const GITHUB_REPO = SUITE.githubRepo;
export const HOMEPAGE_URL = SUITE.homepageUrl;
export const DOCS_URL = P.docsUrl;
export const ACTION_REF = P.actionRef;
export const ENV_PREFIX = `${SUITE.envPrefix}_${P.slug.toUpperCase()}`;
export const USER_AGENT = `${P.cliName}/${VERSION}`;
export { DEFAULT_API_URL, GITHUB_API_VERSION };
