import { useEffect, type RefObject } from "react";

/** Owns shell geometry only. CSS owns layout; this adapter never changes focus or scroll. */
export function useVisibleViewport(app: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const viewport = window.visualViewport;
		const root = app.current;
		if (!viewport || !root) return;
		const apply = (name: string, value: string) => {
			if (root.style.getPropertyValue(name) === value) return;
			if (value) root.style.setProperty(name, value);
			else root.style.removeProperty(name);
		};
		const restore = () => {
			apply("--visible-height", "");
			apply("--visible-top", "");
			apply("--visible-bottom-padding", "");
		};
		const syncViewport = () => {
			const { height, offsetTop, scale } = viewport;
			// Invalid geometry and pinch zoom use CSS, not stale keyboard overrides.
			if (
				!Number.isFinite(height + offsetTop + scale) ||
				height <= 0 ||
				Math.abs(scale - 1) > 0.01
			) {
				restore();
				return;
			}
			// The pan offset positions the shell; it must not also reduce its height.
			const top = Math.max(0, offsetTop);
			const reduced = height < document.documentElement.clientHeight;
			// When both viewports match, CSS needs no geometry override.
			if (top === 0 && height === document.documentElement.clientHeight) {
				restore();
				return;
			}
			apply("--visible-height", `${height}px`);
			apply("--visible-top", `${top}px`);
			// Use available space, not focus, to choose compact bottom spacing.
			apply("--visible-bottom-padding", reduced ? "8px" : "");
		};
		let frame = 0;
		let settleUntil = 0;
		const settle = () => {
			syncViewport();
			frame =
				performance.now() < settleUntil ? requestAnimationFrame(settle) : 0;
		};
		const reconcileViewport = () => {
			// WebKit can publish late measurements without another event. Sample each
			// frame for one second after the last signal, even if early readings agree.
			settleUntil = performance.now() + 1000;
			syncViewport();
			if (!frame) frame = requestAnimationFrame(settle);
		};
		const windowEvents = [
			"resize",
			"scroll",
			"pageshow",
			"focus",
			"orientationchange",
		];
		const documentEvents = ["visibilitychange", "focusin", "focusout", "input"];
		reconcileViewport();
		viewport.addEventListener("resize", reconcileViewport);
		viewport.addEventListener("scroll", reconcileViewport);
		for (const event of windowEvents)
			window.addEventListener(event, reconcileViewport);
		for (const event of documentEvents)
			document.addEventListener(event, reconcileViewport);
		return () => {
			cancelAnimationFrame(frame);
			viewport.removeEventListener("resize", reconcileViewport);
			viewport.removeEventListener("scroll", reconcileViewport);
			for (const event of windowEvents)
				window.removeEventListener(event, reconcileViewport);
			for (const event of documentEvents)
				document.removeEventListener(event, reconcileViewport);
			restore();
		};
	}, [app]);
}
