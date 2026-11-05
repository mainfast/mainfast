/**
 * Brand, org and URL strings for this package, all read from the suite's brand.json
 * (mainfast/brand.json) through @mainfast/shared.
 * Change them there and run `npm run brand:sync` at the suite root.
 */
import { product, SUITE } from '@mainfast/shared/brand';
import pkg from '../package.json' with { type: 'json' };

const P = product('rollcall');

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
/** Name of the check run this tool creates; never audited as a required check of its own. */
export const CHECK_NAME = P.checkName;
/** App id GitHub Actions reports check runs under (github.com). */
export const GITHUB_ACTIONS_APP_ID = 15368;
export const USER_AGENT = `${P.cliName}/${VERSION}`;
/** Starts the tracking issue's body; with the author check it is how the issue is found again. */
export const ISSUE_MARKER = P.commentMarker;
