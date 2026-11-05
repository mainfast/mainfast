// Every test runs with a global fetch that throws: a test that forgets to mock GitHub fails
// loudly instead of reaching the network (tests stub fetch with vi.stubGlobal or inject one).
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { setupFiles: ["test/setup.ts"] } });
