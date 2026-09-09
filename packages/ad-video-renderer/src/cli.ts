import { readFile } from "node:fs/promises";
import { renderVideoProject } from "./render.js";

const [, , inputPath, outputDir = "./video-output"] = process.argv;
if (!inputPath) { console.error("Usage: ad-video-render <request.json> [output-dir]"); process.exit(2); }
const request = JSON.parse(await readFile(inputPath, "utf8"));
const result = await renderVideoProject(request, { outputDir, executeFfmpeg: process.env.ADVIDEO_ENABLE_FFMPEG === "1" });
console.log(JSON.stringify({ ...result, manifest: result.manifest }, null, 2));
