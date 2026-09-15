"use client";

import { Film, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVideoUpload } from "@/lib/adbuilder/use-video-upload";

/**
 * Ad Builder Video.
 *
 * Two decisions, in this order: keep a video you already have, or buy one
 * edited. The free path says it is free beside its own action, and the paid
 * path states its price, deliverable and deadline beside its own, because a
 * price is only honest next to the commitment it buys.
 *
 * Mode is Operate: the next action is obvious and state is legible. Tokens, the
 * shared kit and the CTA ladder are inherited from DESIGN.md; nothing here
 * introduces a second visual language.
 */

export type VideoProjectRow = {
  id: string;
  mode: "uploaded" | "commissioned";
  title: string;
  status: string;
  createdAt: string;
  /** Authorised download reference for a ready source, when one exists. */
  mediaHref?: string;
  mediaLabel?: string;
};

type Props = {
  workspaceId: string;
  projects: VideoProjectRow[];
  loadError: boolean;
  priceLabel: string;
  /** The real commitment, read from the same columns the deadline uses. */
  deadlineSummary: string;
};

const ACCEPT = "video/mp4,video/quicktime,video/webm";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function AdBuilderVideoHome({ workspaceId, projects, loadError, priceLabel, deadlineSummary }: Props) {
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  // The hook is always mounted so the upload state survives re-renders. It is
  // only ever exercised once a project exists.
  const upload = useVideoUpload({ workspaceId, projectId: projectId ?? "" });

  const phase = upload.phase;
  const busy = phase.kind === "preparing" || phase.kind === "uploading" || phase.kind === "validating";
  const percent =
    phase.kind === "uploading" && phase.totalBytes > 0
      ? Math.min(100, Math.round((phase.sentBytes / phase.totalBytes) * 100))
      : 0;

  async function createProject(): Promise<string | null> {
    const name = title.trim();
    if (name.length === 0) {
      setTitleError("Give this video a name.");
      return null;
    }
    setTitleError(null);
    setCreating(true);
    try {
      const response = await fetch("/api/adbuilder/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, mode: "uploaded", title: name }),
      });
      const body = (await response.json().catch(() => ({}))) as { project?: { id?: string }; error?: string };
      if (!response.ok || !body.project?.id) {
        setTitleError(body.error ?? "That video could not be created.");
        return null;
      }
      setProjectId(body.project.id);
      return body.project.id;
    } catch {
      setTitleError("That video could not be created.");
      return null;
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-8 pb-24 md:pb-10">
      <header className="grid gap-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Video</h1>
        <p className="text-sm text-(--muted-foreground)">
          Keep a video you already have, or have one edited for you.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard
          title={title}
          onTitleChange={(value) => {
            setTitle(value);
            if (titleError) setTitleError(null);
          }}
          titleError={titleError}
          creating={creating}
          busy={busy}
          phase={phase}
          fileName={upload.fileName}
          percent={percent}
          onCreate={createProject}
          onPickFile={(file) => void upload.upload(file)}
          onCancel={upload.cancel}
        />

        <Card className="grid content-start gap-4 rounded-(--r-card) border-(--line) bg-card p-5 shadow-card">
          <div className="grid gap-1">
            <h2 className="font-display text-base font-bold">Have one edited for you</h2>
            <p className="text-sm text-(--muted-foreground)">
              Send your brief and footage. We edit one vertical video, and you review a draft before it is final.
            </p>
          </div>

          <dl className="grid gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-(--muted-foreground)">Price</dt>
              <dd className="font-semibold">{priceLabel}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-(--muted-foreground)">Deliverable</dt>
              <dd className="text-right font-semibold">One vertical 1080x1920 MP4, 20-30 seconds</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-(--muted-foreground)">Draft due</dt>
              <dd className="text-right font-semibold">{deadlineSummary}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-(--muted-foreground)">Revisions</dt>
              <dd className="text-right font-semibold">One round, 24 hours after your feedback</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-(--muted-foreground)">Refunds</dt>
              <dd className="text-right font-semibold">Full refund before final delivery</dd>
            </div>
          </dl>

          <Button type="button" variant="outline" disabled>
            Start a brief
          </Button>
          <p className="text-xs text-(--muted-foreground)">Paid video orders are not switched on yet.</p>
        </Card>
      </div>

      {/* A fault state, not a preview: it says what happened and offers the
          only useful action, rather than parking the customer on a dead end. */}
      {loadError ? (
        <div
          role="alert"
          className="grid gap-2 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) p-4 sm:flex sm:items-center sm:justify-between sm:gap-4"
        >
          <p className="text-sm text-(--muted-foreground)">
            Your videos could not be loaded just now. Nothing has been lost.
          </p>
          <Button
            type="button"
            variant="ghost-pill"
            className="shrink-0"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
        </div>
      ) : null}

      <section className="grid gap-3" aria-labelledby="video-library-heading">
        <h2 id="video-library-heading" className="font-display text-lg font-bold">
          Your videos
        </h2>

        {projects.length === 0 ? (
          <Card className="grid place-items-center gap-2 rounded-(--r-card) border-(--line) bg-card p-8 text-center shadow-card">
            <Film className="size-5 text-(--muted-foreground)" aria-hidden />
            <p className="text-sm font-semibold">No videos yet</p>
            <p className="max-w-sm text-sm text-(--muted-foreground)">
              Upload one you already have, or start a brief for an edited video.
            </p>
          </Card>
        ) : (
          <ul className="grid gap-2">
            {projects.map((row) => (
              <li key={row.id}>
                <Card className="grid gap-3 rounded-(--r-card) border border-(--line) bg-card p-4 shadow-card sm:flex sm:items-center sm:justify-between sm:gap-4">
                  <div className="grid min-w-0 gap-0.5">
                    <p className="truncate text-sm font-semibold">{row.title}</p>
                    <p className="text-xs text-(--muted-foreground)">
                      {row.mode === "uploaded" ? "Your video" : "Edited video"} ·{" "}
                      {new Date(row.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-(--line) px-2.5 py-1 text-xs font-semibold">
                      {row.status === "draft" ? "Not finished" : row.status}
                    </span>
                    {row.mediaHref ? (
                      // A download, not a publish: saving a video is not
                      // publishing an ad, so no campaign action is offered here.
                      <Button asChild variant="outline">
                        <a href={`${row.mediaHref}&download=1&filename=${encodeURIComponent(row.mediaLabel ?? "video")}`}>
                          Download
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The free path, as two steps with one action each: name the video, then choose
 * the file. Keeping them separate means the picker is enabled the moment it is
 * shown, instead of being disabled by the project creation that just happened.
 */
function UploadCard(props: {
  title: string;
  onTitleChange: (value: string) => void;
  titleError: string | null;
  creating: boolean;
  busy: boolean;
  phase: ReturnType<typeof useVideoUpload>["phase"];
  fileName: string;
  percent: number;
  onCreate: () => Promise<string | null>;
  onPickFile: (file: File) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);
  const { phase, busy } = props;

  return (
    <Card className="grid content-start gap-4 rounded-(--r-card) border-(--line) bg-card p-5 shadow-card">
      <div className="grid gap-1">
        <h2 className="font-display text-base font-bold">Use a video you already have</h2>
        <p className="text-sm text-(--muted-foreground)">
          Upload it, check it plays, and download it whenever you need it. There is no charge for this.
        </p>
      </div>

      {!ready ? (
        <div className="grid gap-2">
          <Label htmlFor="video-title">Video name</Label>
          <Input
            id="video-title"
            value={props.title}
            onChange={(event) => props.onTitleChange(event.target.value)}
            placeholder="Front of house walkthrough"
            aria-invalid={props.titleError ? true : undefined}
            aria-describedby={props.titleError ? "video-title-error" : undefined}
            disabled={props.creating}
          />
          {props.titleError ? (
            <p id="video-title-error" role="alert" className="text-sm text-(--destructive)">
              {props.titleError}
            </p>
          ) : null}
          <Button
            type="button"
            disabled={props.creating}
            onClick={() => {
              void (async () => {
                const id = await props.onCreate();
                if (id) setReady(true);
              })();
            }}
          >
            {props.creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Add this video
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            id="video-file"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onPickFile(file);
            }}
          />
          <Button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden />
            Choose a video
          </Button>
          <p className="text-xs text-(--muted-foreground)">
            MP4, MOV or WebM. A large file is optimised for playback and your original is kept.
          </p>
        </div>
      )}

      {phase.kind !== "idle" ? (
        <div className="grid gap-2" aria-live="polite">
          <p className="text-sm font-semibold">{props.fileName}</p>

          {busy ? (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--muted)">
                <div
                  className="h-full rounded-full bg-(--ui-cta) transition-[width] duration-300"
                  style={{ width: `${phase.kind === "validating" ? 100 : props.percent}%` }}
                />
              </div>
              <p className="text-xs text-(--muted-foreground)">
                {phase.kind === "validating"
                  ? "Checking the file."
                  : phase.kind === "uploading"
                    ? phase.attempt > 1
                      ? `Retrying, attempt ${phase.attempt}. ${props.percent}% of ${formatBytes(phase.totalBytes)}`
                      : `${props.percent}% of ${formatBytes(phase.totalBytes)}`
                    : "Getting ready."}
              </p>
              <Button type="button" variant="ghost" onClick={props.onCancel}>
                Stop
              </Button>
            </>
          ) : null}

          {phase.kind === "ready" ? <p className="text-sm text-(--success)">Saved to your library.</p> : null}

          {phase.kind === "needs_optimisation" ? (
            <div className="grid gap-1">
              <p className="text-sm text-(--success)">Saved to your library.</p>
              <p className="text-xs text-(--muted-foreground)">
                This file was large, so we are making a lighter copy for playback. Your original is
                kept unchanged, and you can download it now.
              </p>
            </div>
          ) : null}

          {phase.kind === "rejected" || phase.kind === "error" ? (
            <p role="alert" className="text-sm text-(--destructive)">
              {phase.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
