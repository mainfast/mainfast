// brand.json carries a real (sandbox) Polar organisation id, so the default licence validator
// would call Polar. The all-zeros organisation turns it off for every test: tests that check
// validation inject a fake fetch and their own options.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { env: { MAINFAST_POLAR_ORG: "00000000-0000-0000-0000-000000000000" } } });
