"use client";

import { FileText, Image as ImageIcon, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type RefObject } from "react";

import {
  formatUploadFileSize,
  inferAssetMimeType,
  validateAssetUploadFile,
  type AssetUploadConstraints,
} from "@/lib/upload/asset-file";

type AssetUploadDropzoneProps = AssetUploadConstraints & {
  label: string;
  helperText: string;
  actionText?: string;
  previewUrl?: string;
  previewAlt?: string;
  previewFit?: "cover" | "contain";
  previewBackground?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  disabled?: boolean;
  className?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  capturePagePaste?: boolean;
  onFileAccepted: (file: File) => void | Promise<void>;
  onFileRejected?: (message: string) => void;
  onClear?: () => void;
};

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, [contenteditable]"));
}

function hasDroppedFiles(event: DragEvent<HTMLDivElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function getClipboardFile(data: DataTransfer, acceptedTypes: readonly string[]): File | null {
  const items = Array.from(data.items);
  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    const type = inferAssetMimeType(file);
    if (type.startsWith("image/") || acceptedTypes.includes(type)) return file;
  }
  return data.files?.[0] ?? null;
}

export function AssetUploadDropzone({
  label,
  helperText,
  actionText,
  previewUrl,
  previewAlt = "",
  previewFit = "cover",
  previewBackground,
  fileName,
  fileSize,
  fileType,
  acceptedTypes,
  maxBytes,
  typeError,
  sizeError,
  disabled = false,
  className = "",
  inputRef,
  capturePagePaste = false,
  onFileAccepted,
  onFileRejected,
  onClear,
}: AssetUploadDropzoneProps) {
  const generatedId = useId();
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const resolvedInputRef = inputRef ?? fallbackInputRef;
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");
  const selected = Boolean(previewUrl || fileName);
  const resolvedFileType = fileType || "Selected file";
  const fileDetail = fileName
    ? [resolvedFileType, typeof fileSize === "number" ? formatUploadFileSize(fileSize) : ""].filter(Boolean).join(" / ")
    : helperText;
  const accept = acceptedTypes.join(",");
  const descriptionId = `${generatedId}-description`;
  const errorId = `${generatedId}-error`;

  async function acceptFile(file: File | null | undefined) {
    if (!file || disabled) return;
    const validationError = validateAssetUploadFile(file, { acceptedTypes, maxBytes, typeError, sizeError });
    if (validationError) {
      setLocalError(validationError);
      onFileRejected?.(validationError);
      return;
    }

    setLocalError("");
    try {
      await onFileAccepted(file);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not read that file.";
      setLocalError(message);
      onFileRejected?.(message);
    }
  }

  function openFilePicker() {
    if (!disabled) resolvedInputRef.current?.click();
  }

  function handleInputChange(files: FileList | null) {
    const file = files?.[0];
    if (resolvedInputRef.current) resolvedInputRef.current.value = "";
    void acceptFile(file);
  }

  function handlePasteData(data: DataTransfer, eventTarget: EventTarget | null, preventDefault: () => void) {
    if (disabled || isEditableEventTarget(eventTarget)) return;
    const file = getClipboardFile(data, acceptedTypes);
    if (!file) return;
    preventDefault();
    void acceptFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    setDragging(false);
    if (isEditableEventTarget(event.target)) return;
    void acceptFile(event.dataTransfer.files?.[0]);
  }

  useEffect(() => {
    if (!capturePagePaste || disabled) return;
    function handleDocumentPaste(event: globalThis.ClipboardEvent) {
      if (!event.clipboardData) return;
      handlePasteData(event.clipboardData, event.target, () => event.preventDefault());
    }
    window.addEventListener("paste", handleDocumentPaste);
    return () => window.removeEventListener("paste", handleDocumentPaste);
  });

  return (
    <div
      className={`asset-upload-zone${dragging ? " dragging" : ""}${selected ? " has-file" : ""}${className ? ` ${className}` : ""}`}
      data-has-file={selected}
      data-dragging={dragging}
      onDragOver={(event) => {
        if (!disabled && hasDroppedFiles(event)) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onPaste={(event: ClipboardEvent<HTMLDivElement>) =>
        handlePasteData(event.clipboardData, event.target, () => event.preventDefault())
      }
    >
      <input
        ref={resolvedInputRef}
        type="file"
        accept={accept}
        hidden
        disabled={disabled}
        aria-label={label}
        onChange={(event) => handleInputChange(event.target.files)}
      />
      <div className="asset-upload-frame">
        <button
          type="button"
          className="asset-upload-trigger"
          disabled={disabled}
          aria-describedby={`${descriptionId}${localError ? ` ${errorId}` : ""}`}
          onClick={openFilePicker}
        >
          <span className="asset-upload-preview" style={previewBackground ? { background: previewBackground } : undefined} aria-hidden>
            {previewUrl ? <img src={previewUrl} alt={previewAlt} style={{ objectFit: previewFit }} /> : selected ? <FileText size={24} /> : <Upload size={24} />}
          </span>
          <span className="asset-upload-copy">
            <strong>{fileName || actionText || label}</strong>
            <small id={descriptionId}>{selected ? fileDetail : helperText}</small>
          </span>
          <span className="asset-upload-kind" aria-hidden>
            {previewUrl ? <ImageIcon size={17} /> : <Upload size={17} />}
          </span>
        </button>
        {onClear && selected ? (
          <button type="button" className="asset-upload-clear" aria-label={`Clear ${label}`} disabled={disabled} onClick={onClear}>
            <X aria-hidden size={16} />
          </button>
        ) : null}
      </div>
      {localError ? (
        <p className="asset-upload-error" id={errorId}>
          {localError}
        </p>
      ) : null}
    </div>
  );
}
