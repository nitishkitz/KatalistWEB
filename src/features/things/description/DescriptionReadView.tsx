import { Fragment, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import { Linkified } from "@/components/katalist/Linkified";
import { toSafeHref } from "@/lib/linkify";
import { sanitizeDescription, type DescriptionDocument } from "./document";

export function DescriptionReadView({ document }: { document: DescriptionDocument }) {
  function render(node: JSONContent, key: number): ReactNode {
    const children = node.content?.map(render);
    if (node.type === "text") {
      const link = node.marks?.find((mark) => mark.type === "link");
      const href = link?.attrs?.href && toSafeHref(link.attrs.href);
      let text: ReactNode = href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
          {node.text}
        </a>
      ) : (
        <Linkified text={node.text ?? ""} />
      );
      if (node.marks?.some((mark) => mark.type === "bold")) text = <strong>{text}</strong>;
      if (node.marks?.some((mark) => mark.type === "italic")) text = <em>{text}</em>;
      return <Fragment key={key}>{text}</Fragment>;
    }
    switch (node.type) {
      case "paragraph":
        return <p key={key}>{children ?? <br />}</p>;
      case "hardBreak":
        return <br key={key} />;
      case "bulletList":
        return <ul key={key}>{children}</ul>;
      case "orderedList":
        return (
          <ol key={key} start={node.attrs?.start}>
            {children}
          </ol>
        );
      case "listItem":
        return <li key={key}>{children}</li>;
      default:
        return <Fragment key={key}>{children}</Fragment>;
    }
  }
  return <div className="thing-description-prose">{render(sanitizeDescription(document), 0)}</div>;
}
