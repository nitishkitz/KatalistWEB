import { Fragment } from "react";
import { splitLinks } from "@/lib/linkify";

/** Renders text with http(s) URLs as safe, clickable links. */
export function Linkified({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {splitLinks(text).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={className ?? "text-primary underline underline-offset-2 break-all hover:opacity-80"}
            onClick={(event) => event.stopPropagation()}
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
