import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SKILLS_ROOT = path.join(process.cwd(), "hermes", "skills");
const SKILL_FILE = "SKILL.md";
const SKILL_SLUG_RE = /^blockwise-[a-z0-9-]+$/u;

export type HermesSkillSummary = {
  slug: string;
  title: string;
  purpose: string;
  tools: string[];
  relativePath: string;
  byteSize: number;
  updatedAt: string;
  sha256: string;
};

export type HermesSkillDocument = HermesSkillSummary & {
  content: string;
};

export async function listHermesSkills(): Promise<HermesSkillSummary[]> {
  const entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SKILL_SLUG_RE.test(entry.name))
      .map((entry) => readHermesSkill(entry.name)),
  );

  return skills
    .map(({ content: _content, ...summary }) => summary)
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

export async function readHermesSkill(slug: string): Promise<HermesSkillDocument> {
  const filePath = skillPathForSlug(slug);
  const [content, metadata] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  const sha256 = createHash("sha256").update(content).digest("hex");

  return {
    slug,
    title: parseTitle(content) ?? slug,
    purpose: parseSectionSummary(content, "Purpose") ?? "No purpose section in SKILL.md.",
    tools: parseTools(content),
    relativePath: path.posix.join("hermes", "skills", slug, SKILL_FILE),
    byteSize: metadata.size,
    updatedAt: metadata.mtime.toISOString(),
    sha256,
    content,
  };
}

export async function writeHermesSkill(slug: string, content: string): Promise<HermesSkillDocument> {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  await writeFile(skillPathForSlug(slug), normalized, "utf8");
  return readHermesSkill(slug);
}

function skillPathForSlug(slug: string): string {
  if (!SKILL_SLUG_RE.test(slug)) {
    throw new Error("Invalid Hermes skill slug.");
  }

  const filePath = path.join(SKILLS_ROOT, slug, SKILL_FILE);
  const relative = path.relative(SKILLS_ROOT, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid Hermes skill path.");
  }
  return filePath;
}

function parseTitle(content: string): string | null {
  const match = /^#\s+(.+)$/mu.exec(content);
  return match?.[1]?.trim() || null;
}

function parseSectionSummary(content: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|$)`, "mu").exec(content);
  const section = match?.[1]
    ?.replace(/```[\s\S]*?```/gu, " ")
    .replace(/[`*_>#-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (!section) return null;
  return section.length > 180 ? `${section.slice(0, 177).trim()}...` : section;
}

function parseTools(content: string): string[] {
  const match = /^##\s+Tools\s*\n([\s\S]*?)(?=\n##\s+|\n#\s+|$)/mu.exec(content);
  if (!match?.[1]) return [];

  return match[1]
    .split("\n")
    .map((line) => /^-\s+`?([^`\n]+?)`?\s*$/u.exec(line)?.[1]?.trim())
    .filter((tool): tool is string => Boolean(tool))
    .slice(0, 8);
}
