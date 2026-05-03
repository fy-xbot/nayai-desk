import { useCallback, type RefObject } from "react";

export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  maxHeight = 150,
) {
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, [ref, maxHeight]);

  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
  }, [ref]);

  return { resize, reset };
}
