export function parseArgs(argv) {
  let regionsOnly = false;
  const templateIds = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--regions-only") {
      regionsOnly = true;
      continue;
    }
    if (argument === "--template" || argument.startsWith("--template=")) {
      const value = argument === "--template" ? argv[++index] : argument.slice("--template=".length);
      if (!value) throw new Error("--template needs at least one template id");
      for (const id of value.split(",").map((entry) => entry.trim()).filter(Boolean)) templateIds.add(id);
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      return { help: true, regionsOnly, templateIds };
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { help: false, regionsOnly, templateIds };
}

export function selectTemplateFiles(fileNames, templateIds) {
  const selected = templateIds.size
    ? fileNames.filter((fileName) => templateIds.has(fileName.replace(/\.json$/u, "")))
    : fileNames;
  const selectedIds = new Set(selected.map((fileName) => fileName.replace(/\.json$/u, "")));
  const unknown = [...templateIds].filter((id) => !selectedIds.has(id));
  if (unknown.length) throw new Error(`Unknown template id(s): ${unknown.join(", ")}`);
  return selected;
}
