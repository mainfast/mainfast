// The workflow each check installs: its own example, unchanged, so third-party actions stay pinned
// the same way and there is one source for each file.
import { SUITE, type ProductSlug } from "@mainfast/shared/brand";
import evidence from "../../evidence/examples/workflows/evidence.yml?raw";
import intact from "../../intact/examples/mainfast-intact.yml?raw";
import migrations from "../../migrations/examples/mainfast-migrations.yml?raw";
import owners from "../../owners/examples/owners.yml?raw";
import rollcall from "../../rollcall/examples/rollcall.yml?raw";

export const WORKFLOWS: Record<ProductSlug, string> = { intact, migrations, rollcall, owners, evidence };

export const workflowPath = (slug: ProductSlug) => `.github/workflows/${SUITE.githubOrg}-${slug}.yml`;

export const STARTER_CONFIG = `# yaml-language-server: $schema=${SUITE.schemaUrl}
# One optional section per check. Defaults apply to any check without one.
# Reference: ${SUITE.homepageUrl}/blob/main/docs/config.md
version: 1
`;
