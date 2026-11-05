import { main } from "./cli.ts";

main(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
}).then((code) => {
  process.exitCode = code;
});
