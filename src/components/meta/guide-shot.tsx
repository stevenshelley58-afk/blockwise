"use client";

import Image from "next/image";
import { ZoomIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * One real Meta screenshot. The thumbnail sits inline in a guide step so the
 * instruction reads with its picture; the dialog opens the full-size screen
 * for anyone who needs to match it exactly.
 */
export function GuideShot({
  src,
  fullSrc,
  width,
  height,
  fullWidth,
  fullHeight,
  alt,
  title,
}: {
  src: string;
  fullSrc?: string;
  width: number;
  height: number;
  fullWidth?: number;
  fullHeight?: number;
  alt: string;
  title: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group relative block w-full cursor-pointer overflow-hidden rounded-(--r-card) border border-(--line-heavy) bg-white"
        >
          <Image
            className="h-auto w-full"
            src={src}
            width={width}
            height={height}
            alt={alt}
            sizes="(min-width: 768px) 620px, 100vw"
          />
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/70 py-2 text-[11.5px] font-semibold text-white opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
            <ZoomIn aria-hidden size={14} />
            View full size
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[min(1100px,92vw)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto rounded-(--r-card) border border-(--line-heavy) bg-white p-2">
          <Image
            className="mx-auto h-auto w-auto max-w-full"
            src={fullSrc ?? src}
            width={fullWidth ?? width}
            height={fullHeight ?? height}
            alt={alt}
            sizes="(min-width: 1100px) 1050px, 92vw"
          />
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          Real Meta Business Settings screen. Meta may change labels.
        </p>
      </DialogContent>
    </Dialog>
  );
}
