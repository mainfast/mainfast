// brand.json carries a real (sandbox) Polar organization id, so the default license validator
// would call Polar. The all-zeros organization turns it off for every test: tests that check
// validation inject a fake fetch and their own options.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { env: { MAINFAST_POLAR_ORG: "00000000-0000-0000-0000-000000000000" } } });
