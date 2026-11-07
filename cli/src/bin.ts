import { main } from "./main.ts";

main(process.argv.slice(2)).then(
  (code) => {
    // -1: the MCP server keeps running on stdin.
    if (code >= 0) process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`mainfast: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  },
);
