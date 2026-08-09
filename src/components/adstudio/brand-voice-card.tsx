"use client";

import { useState } from "react";

import type { AdStudioBrandKit } from "@/lib/adstudio";

const VOICE_PRESETS = ["Warm & personal", "Premium & understated", "Straight-talking", "Data-led"];
const VOICE_LIMIT = 300;

type BrandTone = AdStudioBrandKit["tone"];

/* ------------------------------------------------------------------ */
/* tag row (phrases / never say)                                       */
/* ------------------------------------------------------------------ */

function TagRow({
  items,
  tone,
  onAdd,
  onRemove,
}: {
  items: string[];
  tone: "yes" | "no";
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <div className="bs-tagrow">
      {items.map((item) => (
        <span key={item} className={tone === "no" ? "no" : ""}>
          {item}
          <b role="button" aria-label={`Remove ${item}`} onClick={() => onRemove(item)}>
            ✕
          </b>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          placeholder="type, press Enter"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setAdding(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) {
              onAdd(draft.trim());
              setDraft("");
            }
            if (event.key === "Escape") setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="addbtn" onClick={() => setAdding(true)}>
          ＋ Add phrase
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* voice & tone card                                                   */
/* ------------------------------------------------------------------ */

export function VoiceToneCard({
  tone,
  onToneChange,
}: {
  tone: BrandTone;
  onToneChange: <K extends keyof BrandTone>(key: K, value: BrandTone[K]) => void;
}) {
  return (
    <section className="bs-card">
      <h3>Voice &amp; tone</h3>
      <div className="f">
        <label>
          How should your ads sound?
          <small>
            {(tone.voice || "").length} / {VOICE_LIMIT}
          </small>
        </label>
        <textarea
          value={tone.voice}
          maxLength={VOICE_LIMIT}
          rows={3}
          onChange={(event) => onToneChange("voice", event.target.value)}
        />
        <div className="presets">
          {VOICE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() =>
                onToneChange(
                  "voice",
                  `${(tone.voice || "").replace(/\s*$/, "")}${tone.voice ? " " : ""}${preset}.`.slice(
                    0,
                    VOICE_LIMIT,
                  ),
                )
              }
            >
              + {preset}
            </button>
          ))}
        </div>
      </div>
      <div className="f">
        <label>Use phrases like</label>
        <TagRow
          items={tone.preferredPhrases}
          tone="yes"
          onAdd={(value) => onToneChange("preferredPhrases", [...tone.preferredPhrases, value])}
          onRemove={(value) =>
            onToneChange(
              "preferredPhrases",
              tone.preferredPhrases.filter((item) => item !== value),
            )
          }
        />
      </div>
      <div className="f">
        <label>Never say</label>
        <TagRow
          items={tone.avoid}
          tone="no"
          onAdd={(value) => onToneChange("avoid", [...tone.avoid, value])}
          onRemove={(value) =>
            onToneChange(
              "avoid",
              tone.avoid.filter((item) => item !== value),
            )
          }
        />
      </div>
    </section>
  );
}
