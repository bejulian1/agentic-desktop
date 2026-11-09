import path from "node:path";
import { productionBuild } from "./build-lib.ts";

const result = productionBuild(path.resolve(import.meta.dirname, ".."));
console.log(result ? `Bygg ${result.build} av v${result.version} er ferdig.` : "web har ikke noe byggskript ennå.");
