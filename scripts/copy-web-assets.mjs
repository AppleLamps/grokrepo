import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "web", "static");
const destination = path.join(root, "dist", "web", "static");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
