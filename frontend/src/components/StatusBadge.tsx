import { STATUS_COLOR, STATUS_ICON, STATUS_LABEL } from "../theme";
import type { Status } from "../types";

export function StatusBadge({ status, compact = false }: { status: Status; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2" title={STATUS_LABEL[status]}>
      <span style={{ color: STATUS_COLOR[status] }} aria-hidden>
        {STATUS_ICON[status]}
      </span>
      {compact ? <span className="sr-only">{STATUS_LABEL[status]}</span> : STATUS_LABEL[status]}
    </span>
  );
}
