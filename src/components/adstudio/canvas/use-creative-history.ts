"use client";

import { useCallback, useRef, useState } from "react";

import type { CreativeDesignJson } from "@/lib/adstudio/creative-design-json.ts";

const MAX_HISTORY = 40;

export function useCreativeHistory(initialJson: CreativeDesignJson | null) {
  const historyRef = useRef<string[]>(initialJson ? [stableStringify(initialJson)] : []);
  const [index, setIndex] = useState(historyRef.current.length > 0 ? 0 : -1);

  const push = useCallback((json: CreativeDesignJson) => {
    const next = stableStringify(json);
    const current = index >= 0 ? historyRef.current[index] : null;
    if (current === next) return;

    const history = historyRef.current.slice(0, index + 1);
    history.push(next);
    if (history.length > MAX_HISTORY) history.shift();
    historyRef.current = history;
    setIndex(history.length - 1);
  }, [index]);

  const reset = useCallback((json: CreativeDesignJson | null) => {
    historyRef.current = json ? [stableStringify(json)] : [];
    setIndex(json ? 0 : -1);
  }, []);

  const undo = useCallback((): CreativeDesignJson | null => {
    if (index <= 0) return null;
    const nextIndex = index - 1;
    setIndex(nextIndex);
    return parseJson(historyRef.current[nextIndex]);
  }, [index]);

  const redo = useCallback((): CreativeDesignJson | null => {
    if (index >= historyRef.current.length - 1) return null;
    const nextIndex = index + 1;
    setIndex(nextIndex);
    return parseJson(historyRef.current[nextIndex]);
  }, [index]);

  return {
    canUndo: index > 0,
    canRedo: index >= 0 && index < historyRef.current.length - 1,
    push,
    reset,
    undo,
    redo,
  };
}

function stableStringify(value: CreativeDesignJson): string {
  return JSON.stringify(value);
}

function parseJson(value: string | undefined): CreativeDesignJson | null {
  if (!value) return null;
  return JSON.parse(value) as CreativeDesignJson;
}
