import { MoreHorizontal } from "lucide-react";

import { withBasePath } from "@/lib/homepage-concept/content";

type AdPreviewProps = {
  image: string;
  postCopy: string;
  linkTitle: string;
  compact?: boolean;
};

export function AdPreview({ image, postCopy, linkTitle, compact = false }: AdPreviewProps) {
  return (
    <article className={`hc-ad-preview${compact ? " hc-ad-preview--compact" : ""}`}>
      <div className="hc-ad-account">
        <span className="hc-ad-avatar" aria-hidden="true">YA</span>
        <span>
          <strong>Your Agency</strong>
          <small>Sponsored</small>
        </span>
        <MoreHorizontal aria-hidden="true" size={19} />
      </div>
      <p className="hc-ad-copy">{postCopy}</p>
      <div className="hc-ad-image-wrap">
        <img
          className="hc-ad-image"
          src={withBasePath(image)}
          alt="Finished real estate feed ad example"
          width="1080"
          height="1350"
        />
      </div>
      <div className="hc-ad-link">
        <span>
          <small>YOURAGENCY.COM.AU</small>
          <strong>{linkTitle}</strong>
        </span>
        <span className="hc-ad-link-button">Learn more</span>
      </div>
    </article>
  );
}
