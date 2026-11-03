import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx"];

function withExtension(url) {
  if (/\.[cm]?[jt]sx?$/.test(url)) return url;
  const filePath = fileURLToPath(url);
  for (const suffix of candidates) {
    if (existsSync(filePath + suffix)) return pathToFileURL(filePath + suffix).href;
  }
  return url;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = pathToFileURL(join(root, "src", specifier.slice(2))).href;
    return nextResolve(withExtension(target), context);
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const target = pathToFileURL(resolvePath(parentDir, specifier)).href;
    return nextResolve(withExtension(target), context);
  }
  return nextResolve(specifier, context);
}
