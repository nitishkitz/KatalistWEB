import portrait from "@/assets/chat-head/coey-portrait.png";
import outerRing from "@/assets/chat-head/outer-ring.svg";
import whiteInset from "@/assets/chat-head/white-inset.svg";
import innerDisc from "@/assets/chat-head/inner-disc.svg";
import portraitMask from "@/assets/chat-head/portrait-mask.svg";
import "./coey-chat-head.css";

/** Figma 77:841, scaled as one composition without changing SVG geometry. */
export function CoeyChatHeadArtwork({ size }: { size: number }) {
  return (
    <span
      className="coey-chat-head-artwork"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="coey-chat-head-canvas" style={{ transform: `scale(${size / 99.803253})` }}>
        <img className="coey-chat-head-outer" src={outerRing} alt="" draggable={false} />
        <img className="coey-chat-head-inset" src={whiteInset} alt="" draggable={false} />
        <img className="coey-chat-head-disc" src={innerDisc} alt="" draggable={false} />
        <span className="coey-chat-head-portrait" style={{ maskImage: `url("${portraitMask}")` }}>
          <img src={portrait} alt="" draggable={false} />
        </span>
      </span>
    </span>
  );
}
