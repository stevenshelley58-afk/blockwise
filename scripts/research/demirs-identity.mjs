function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function meta(row) {
  return row?.metadata?.demirs_wa_licence_register ?? row?.metadata ?? {};
}

function identity(row) {
  const source = meta(row);
  return {
    licence: clean(row?.licence_number ?? source.licence_number),
    entity: clean(source.entity_id ?? row?.entity_id),
  };
}

function name(row) {
  return clean(row?.normalized_name ?? row?.normalizedName);
}

export function resolveDemirsIdentity(subject, existingRows = []) {
  const wanted = identity(subject);
  const wantedName = name(subject);
  const rows = Array.isArray(existingRows) ? existingRows : [];
  const sameName = rows.filter((row) => wantedName && name(row) === wantedName);
  const stable = wanted.licence || wanted.entity;

  if (!stable) {
    return { status: "ambiguous", reason: "missing_stable_identity" };
  }

  const stableMatches = rows.filter((row) => {
    const found = identity(row);
    return (wanted.licence && found.licence === wanted.licence) || (wanted.entity && found.entity === wanted.entity);
  });
  const contradictory = (row) => {
    const found = identity(row);
    return (wanted.licence && found.licence && found.licence !== wanted.licence) ||
      (wanted.entity && found.entity && found.entity !== wanted.entity);
  };

  if (stableMatches.some(contradictory)) {
    return { status: "ambiguous", reason: "contradictory_stable_identity" };
  }
  const validMatches = stableMatches.filter((row) => !contradictory(row));
  if (validMatches.length === 1) {
    return { status: "matched", row: validMatches[0], reason: "exact_stable_identity" };
  }
  if (validMatches.length > 1) {
    return { status: "ambiguous", reason: "multiple_stable_identity_matches" };
  }
  if (sameName.length) {
    return { status: "ambiguous", reason: "same_name_without_exact_stable_identity" };
  }
  return { status: "missing", reason: "stable_identity_absent" };
}
