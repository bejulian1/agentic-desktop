// npm start: builds if the UI is out of date, then runs the server in this same process.
import path from "node:path";
import { needsBuild, productionBuild } from "./build-lib.ts";
import { main } from "../server/src/index.ts";

const root = path.resolve(import.meta.dirname, "..");
// With AD_WEB_DIST the server serves another folder, so web/dist is left alone. Tests rely on
// this: without it, a test of npm start rebuilt web/dist and bumped the build number.
if (!process.env.AD_WEB_DIST && needsBuild(root)) {
  console.log("Bygger grensesnittet...");
  productionBuild(root);
}
await main(process.argv.slice(2));
