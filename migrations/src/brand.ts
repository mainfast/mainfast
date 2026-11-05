/**
 * Brand, org and URL strings for this package, all read from the suite's brand.json
 * (mainfast/brand.json) through @mainfast/shared.
 * Change them there and run `npm run brand:sync` at the suite root.
 */
import { product, SUITE } from '@mainfast/shared/brand';
import pkg from '../package.json' with { type: 'json' };

const P = product('migrations');

export const BRAND = SUITE.name;
export const PRODUCT = P.productName;
export const TOOL_ID = P.slug;
export const CLI_NAME = P.cliName;
export const VERSION: string = pkg.version;
export const GITHUB_ORG = SUITE.githubOrg;
export const GITHUB_REPO = SUITE.githubRepo;
export const HOMEPAGE_URL = SUITE.homepageUrl;
export const DOCS_URL = P.docsUrl;
export const ACTION_REF = P.actionRef;
export const CONFIG_FILE = SUITE.configFile;
export const CONFIG_FILE_ALT = SUITE.configFileAlt;
export const CONFIG_SECTION = P.configSection;
/** Hidden marker that identifies the one PR comment this tool keeps updated. */
export const COMMENT_MARKER = P.commentMarker;
export const DEFAULT_STALE_LABEL = P.staleLabel!;
export const STATUS_CONTEXT = P.statusContext!;
export const USER_AGENT = `${P.cliName}/${VERSION}`;
