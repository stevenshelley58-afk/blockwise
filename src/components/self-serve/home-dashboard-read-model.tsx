"use client";

import { useCallback, useEffect, useState } from "react";

import { HomeDashboard, type HomeData } from "@/components/self-serve/home-dashboard";
import {
  homeSafeReadModelFromData,
  mergeHomeSafeReadModel,
  type HomeSafeReadModel,
} from "@/lib/home/home-safe-read-model";
import {
  READ_MODEL_SCHEMA_VERSION,
  readLocalReadModel,
  writeLocalReadModel,
} from "@/lib/read-models/browser-store";
import { useReportingInvalidation } from "@/lib/read-models/use-reporting-invalidation";

/**
 * Runs `task` once the browser is idle, falling back to a short timer where
 * `requestIdleCallback` is unavailable (Safari). Returns the matching cancel.
 */
function scheduleIdle(task: () => void): () => void {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const handle = window.requestIdleCallback(task, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(task, 1200);
  return () => clearTimeout(handle);
}

export function HomeDashboardReadModel(input: {
  initialData: HomeData;
  initialEtag: string;
  initialGeneratedAt: string;
  userId: string;
  workspaceId: string;
}) {
  const [data, setData] = useState(input.initialData);
  const [etag, setEtag] = useState(input.initialEtag);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/home-dashboard", {
      cache: "no-store",
      headers: etag ? { "if-none-match": etag } : undefined,
    });
    if (response.status === 304) return;
    if (!response.ok) return;
    const safe = (await response.json()) as HomeSafeReadModel;
    const nextEtag = response.headers.get("etag") ?? etag;
    const fetchedAt =
      response.headers.get("x-bw-read-model-generated-at") ?? new Date().toISOString();
    setData((current) => mergeHomeSafeReadModel(current, safe));
    setEtag(nextEtag);
    await writeLocalReadModel({
      schemaVersion: READ_MODEL_SCHEMA_VERSION,
      userId: input.userId,
      workspaceId: input.workspaceId,
      surface: "home",
      etag: nextEtag,
      fetchedAt,
      data: safe,
    });
  }, [etag, input.userId, input.workspaceId]);

  useEffect(() => {
    let cancelled = false;
    let cancelIdle: () => void = () => {};
    void (async () => {
      const cached = await readLocalReadModel<HomeSafeReadModel>({
        userId: input.userId,
        workspaceId: input.workspaceId,
        surface: "home",
      });
      if (
        !cancelled &&
        cached &&
        Date.parse(cached.fetchedAt) > Date.parse(input.initialGeneratedAt)
      ) {
        setData((current) => mergeHomeSafeReadModel(current, cached.data));
        setEtag(cached.etag);
      } else {
        await writeLocalReadModel({
          schemaVersion: READ_MODEL_SCHEMA_VERSION,
          userId: input.userId,
          workspaceId: input.workspaceId,
          surface: "home",
          etag: input.initialEtag,
          fetchedAt: input.initialGeneratedAt,
          data: homeSafeReadModelFromData(input.initialData),
        });
      }
      // The server already rendered this dashboard from the same read model, so
      // the revalidation is a background nicety, not first-paint work. Kicking
      // it off immediately put a ~1s request on the wire while the page was
      // still loading its own assets; wait for the browser to go idle instead.
      cancelIdle = scheduleIdle(() => {
        if (!cancelled) void refresh();
      });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [
    input.initialEtag,
    input.initialGeneratedAt,
    input.initialData,
    input.userId,
    input.workspaceId,
    refresh,
  ]);

  useReportingInvalidation({ workspaceId: input.workspaceId, onInvalidate: refresh });

  return <HomeDashboard data={data} />;
}
