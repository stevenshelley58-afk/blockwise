export {
  renderPlacement,
  renderBoth,
  TextPreflightError,
  TEXT_PREFLIGHT_ERROR_CODE,
  type RenderInput,
  type RenderOutput,
  type RenderDiagnostics,
  type TextRenderDiagnostic,
  type PixelBounds,
  type TextPreflightViolation,
} from "./renderer.js";
export {
  auditTemplateArtifact,
  type AuditArtifactInput,
  type AuditArtifactResult,
  type AuditCheck,
  type RenderAuditReceipt,
} from "./audit.js";
