import type { LucideIcon, LucideProps } from "lucide-react";
import {
  AlertCircle,
  ArrowDownUp,
  AtSign,
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDot,
  CircleGauge,
  Clock3,
  Filter,
  Hash,
  List,
  MoreHorizontal,
  MousePointerClick,
  Search,
  Send,
  Sparkles,
  Star,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

export type KatalistIconName =
  | "magic-box"
  | "toss"
  | "catch"
  | "now-smash"
  | "next-rally"
  | "later-lob"
  | "sorted"
  | "not-started"
  | "under-progress"
  | "waiting"
  | "caught"
  | "stuck"
  | "stale"
  | "nudge-paw-tap"
  | "search"
  | "filter"
  | "sort"
  | "calendar"
  | "clock-time"
  | "favourite-star"
  | "more-ellipsis"
  | "katalist-spark"
  | "clear-input"
  | "send-toss"
  | "at-person"
  | "hash-bucket"
  | "urgent"
  | "date-detection"
  | "time-detection"
  | "ai-intelligence"
  | "list"
  | "chevron-down"
  | "chevron-right";

// These fallbacks preserve the typed icon boundary until the approved SVG masters are supplied.
// Replacing a fallback with a validated SVG asset will not require Court component changes.
const fallbackIcons: Record<KatalistIconName, LucideIcon> = {
  "magic-box": WandSparkles,
  toss: Send,
  catch: MousePointerClick,
  "now-smash": Zap,
  "next-rally": CircleGauge,
  "later-lob": CircleDashed,
  sorted: Check,
  "not-started": Circle,
  "under-progress": CircleDot,
  waiting: Clock3,
  caught: Check,
  stuck: AlertCircle,
  stale: AlertCircle,
  "nudge-paw-tap": BellRing,
  search: Search,
  filter: Filter,
  sort: ArrowDownUp,
  calendar: CalendarDays,
  "clock-time": Clock3,
  "favourite-star": Star,
  "more-ellipsis": MoreHorizontal,
  "katalist-spark": Sparkles,
  "clear-input": X,
  "send-toss": Send,
  "at-person": AtSign,
  "hash-bucket": Hash,
  urgent: AlertCircle,
  "date-detection": CalendarDays,
  "time-detection": Clock3,
  "ai-intelligence": Sparkles,
  list: List,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
};

export function KatalistIcon({
  name,
  ...props
}: { name: KatalistIconName } & Omit<LucideProps, "name">) {
  const Icon = fallbackIcons[name];
  return <Icon aria-hidden="true" strokeWidth={1.75} {...props} />;
}
