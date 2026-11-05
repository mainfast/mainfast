// Suite-level tests only (brand drift, .mainfast.yml schema). Each package runs its own.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
