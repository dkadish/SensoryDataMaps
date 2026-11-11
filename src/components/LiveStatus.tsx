import { useEffect, useRef, useState } from "react";
import { fetchLiveSamples, type LiveSnapshot } from "../live/brianBackend";

/** How often a live layer asks for new data; the app flushes every 5 s. */
export const LIVE_POLL_MS = 5000;

export interface LiveSource {
  backendUrl: string;
  walkId: string;
  /** Polling for new data. Paused layers keep what they have. */
  following: boolean;
}

interface Props {
  source: LiveSource;
  /** Time (epoch ms) of the newest snapshot the layer has, or undefined. */
  lastTime: number | undefined;
  sampleCount: number;
  onSnapshots: (snapshots: LiveSnapshot[]) => void;
  onFollowingChange: (following: boolean) => void;
}

/**
 * Polls BrianBackend for a walk's new snapshots while the layer is following,
 * and shows the connection state. Mounted inside the layer card, so removing
 * the layer stops the polling.
 */
export default function LiveStatus({
  source,
  lastTime,
  sampleCount,
  onSnapshots,
  onFollowingChange,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  // Read the latest values inside the polling loop without restarting it.
  const lastTimeRef = useRef(lastTime);
  lastTimeRef.current = lastTime;
  const onSnapshotsRef = useRef(onSnapshots);
  onSnapshotsRef.current = onSnapshots;

  const { backendUrl, walkId, following } = source;

  useEffect(() => {
    if (!following) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const snapshots = await fetchLiveSamples(
          backendUrl,
          walkId,
          lastTimeRef.current,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (snapshots.length) onSnapshotsRef.current(snapshots);
        setError(null);
        setCheckedAt(Date.now());
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      }
      // Pause polling while the tab is hidden; resume on the next visible tick.
      timer = setTimeout(poll, document.hidden ? LIVE_POLL_MS * 6 : LIVE_POLL_MS);
    };
    poll();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [backendUrl, walkId, following]);

  const stale = lastTime !== undefined && checkedAt !== null && checkedAt - lastTime > 60_000;

  return (
    <div className="live-status">
      <p className="small">
        {following ? (
          <span className={`live-dot ${error || stale ? "idle" : ""}`} aria-hidden="true" />
        ) : null}
        {following
          ? error
            ? "Live — connection problem, retrying"
            : stale
              ? "Live — waiting for new data"
              : "Live — updating every 5 s"
          : "Paused"}
        {" · "}
        {sampleCount} snapshots
        {lastTime !== undefined && ` · last ${new Date(lastTime).toLocaleTimeString()}`}
      </p>
      {error && <p className="error">{error}</p>}
      <button type="button" className="small-btn" onClick={() => onFollowingChange(!following)}>
        {following ? "Pause updates" : "Resume updates"}
      </button>
    </div>
  );
}
