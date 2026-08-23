import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
for (const browser of ["chrome", "firefox"]) {
  const outdir = `dist/${browser}`;
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/background.ts", "src/content.tsx", "src/options.tsx"],
    outdir,
    bundle: true,
    format: "iife",
    target: browser === "chrome" ? "chrome120" : "firefox121",
    minify: true,
    sourcemap: false,
  });
  await Promise.all([
    cp(`src/manifest.${browser}.json`, `${outdir}/manifest.json`),
    cp("src/content.css", `${outdir}/content.css`),
    cp("src/options.css", `${outdir}/options.css`),
    cp("src/options.html", `${outdir}/options.html`),
  ]);
}
