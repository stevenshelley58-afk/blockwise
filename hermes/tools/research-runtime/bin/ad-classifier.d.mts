export const CLASSIFIER_VERSION: string;
export type AdClassifierClassification = {
  ad_type: string;
  primary_intent: string;
  classifier_version: string;
  evidence_source: string;
  [key: string]: unknown;
};
export type AdClassifierResult = {
  classification: AdClassifierClassification;
  model: string;
  evidenceSource: string;
  usedFallback: boolean;
  fallbackReason: string | null;
};
export function classifyCreativeDeterministically(
  creative: Record<string, unknown>,
  options?: Record<string, unknown>,
): AdClassifierClassification;
export function classifyCreativeWithModels(
  creative: Record<string, unknown>,
  capturedAssets?: Array<Record<string, unknown>>,
  options?: Record<string, unknown>,
): Promise<AdClassifierResult>;
export function shouldReclassifyCreative(row: Record<string, unknown>, classifierVersion?: string): boolean;
export function shouldWaitForMediaClassification(
  creative: Record<string, unknown>,
  capturedAssets?: Array<Record<string, unknown>>,
): boolean;
export function hasUnresolvedDynamicPlaceholder(creative: Record<string, unknown>): boolean;
export function assessCapturedImageQuality(input?: {
  byteSize?: number | null;
  byte_size?: number | null;
  width?: number | null;
  height?: number | null;
}): { displayable: boolean; reason: string | null };
export function readImageDimensions(buffer: Uint8Array, contentType?: string | null): { width: number; height: number } | null;
export function hasUsableCapturedMedia(capturedAssets?: Array<Record<string, unknown>>): boolean;
export function shouldDisplayClassifiedCreative(
  creative: Record<string, unknown>,
  capturedAssets?: Array<Record<string, unknown>>,
  classification?: Record<string, unknown>,
): boolean;
export function normaliseAdClassification(
  input: Record<string, unknown>,
  options?: Record<string, unknown>,
): AdClassifierClassification;
