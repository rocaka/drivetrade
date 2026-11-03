import { useEffect } from "react";
import { useWorld } from "@/lib/world/store";
export function WorldClock({ active = true }: { active?: boolean }) {
  useEffect(() => {
    if (!active) {
      useWorld.getState().setPlaying(false);
      return;
    }
    let frame = 0;
    let last = performance.now();
    let elapsed = 0;
    let submitted = 0;
    const loop = (now: number) => {
      const state = useWorld.getState();
      const delta = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (
        state.playing &&
        !state.busy &&
        !state.advancing &&
        !state.readOnly &&
        !state.maintenance &&
        !document.hidden
      ) {
        elapsed += delta * state.speed;
        if (elapsed >= 1 && now - submitted > 400) {
          const seconds = Math.min(120, Math.floor(elapsed));
          elapsed -= seconds;
          submitted = now;
          void state.advance(seconds);
        }
      }
      frame = requestAnimationFrame(loop);
    };
    const hidden = () => {
      last = performance.now();
      elapsed = 0;
      if (document.hidden) useWorld.getState().setPlaying(false);
    };
    frame = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame);
      useWorld.getState().setPlaying(false);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [active]);
  return null;
}
