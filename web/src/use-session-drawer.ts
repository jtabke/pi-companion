import { useEffect, useRef, type SyntheticEvent } from "react";

/** Native dialog motion, gestures and focus restoration; no session or input authority. */
export function useSessionDrawer(paired: boolean) {
	const app = useRef<HTMLElement>(null);
	const sidebar = useRef<HTMLDialogElement>(null);
	const sessionsToggle = useRef<HTMLButtonElement>(null);
	const sidebarMotion = useRef(0);
	function openSessions() {
		const dialog = sidebar.current;
		if (!dialog || dialog.open) return;
		sidebarMotion.current++;
		delete dialog.dataset.closing;
		dialog.showModal();
	}
	function closeSessions() {
		const dialog = sidebar.current;
		if (!dialog?.open || dialog.dataset.closing) return;
		const motion = ++sidebarMotion.current;
		// Closing during entry starts at the rendered position, without a jump.
		dialog.style.setProperty(
			"--session-offset",
			getComputedStyle(dialog).transform,
		);
		dialog.style.setProperty(
			"--session-shade",
			getComputedStyle(dialog, "::backdrop").opacity,
		);
		dialog.dataset.closing = "true";
		const animations = dialog.getAnimations({ subtree: true });
		const finish = () => {
			if (
				sidebarMotion.current === motion &&
				sidebar.current === dialog &&
				dialog.open
			)
				dialog.close();
		};
		if (!animations.length)
			finish(); // Reduced motion closes synchronously.
		else
			void Promise.all(animations.map((animation) => animation.finished)).then(
				finish,
				finish,
			);
	}
	useEffect(
		() => () => {
			sidebarMotion.current++;
		},
		[paired],
	);
	useEffect(() => {
		const node = app.current;
		if (!paired || !node) return;
		let swipe:
			| {
					x: number;
					y: number;
					identifier: number;
					horizontal: boolean;
					canceled: boolean;
					furthest: number;
					closing: boolean;
					target: Element;
			  }
			| undefined;
		let backdropTap: { pointer: number; x: number; y: number } | undefined;
		let compatibilityClick:
			{ target: Element; until: number; backdrop?: boolean } | undefined;
		function cancel() {
			swipe = undefined;
			compatibilityClick = undefined;
		}
		function start(event: TouchEvent) {
			cancel(); // A new deliberate touch must never inherit click suppression.
			if (event.touches.length !== 1) backdropTap = undefined;
			const target = event.target instanceof Element ? event.target : undefined;
			const closing = !!sidebar.current?.open;
			const control = target?.closest("button, a, summary");
			const sessionTarget = control?.matches(
				".session-card > button:not(.rename-session), .session-details > summary",
			);
			if (
				!matchMedia("(max-width: 639px)").matches ||
				(sidebar.current?.open && sidebar.current.dataset.closing) ||
				event.touches.length !== 1 ||
				!target ||
				(control && !(closing && sessionTarget)) ||
				target.closest(
					"input, textarea, select, label, [contenteditable]:not([contenteditable=false]), pre, code, table, .image, .composer, .questions",
				) ||
				window.getSelection()?.isCollapsed === false
			)
				return;
			const touch = event.touches[0];
			if (closing) {
				const dialog = sidebar.current!;
				const bounds = dialog.getBoundingClientRect();
				if (
					!dialog.contains(target) ||
					touch.clientX < bounds.left ||
					touch.clientX > bounds.right ||
					touch.clientY < bounds.top ||
					touch.clientY > bounds.bottom
				)
					return;
			} else {
				if (touch.clientX < 0 || touch.clientX > 24) return;
				// Leave independently horizontally scrollable content to the browser.
				for (
					let content: Element | null = target;
					content && content !== node;
					content = content.parentElement
				) {
					if (
						content.scrollWidth > content.clientWidth &&
						/auto|scroll/.test(getComputedStyle(content).overflowX)
					)
						return;
				}
			}
			swipe = {
				x: touch.clientX,
				y: touch.clientY,
				identifier: touch.identifier,
				horizontal: false,
				canceled: false,
				furthest: 0,
				closing,
				target: control ?? target,
			};
		}
		function move(event: TouchEvent) {
			if (!swipe) return;
			const touch = event.touches[0];
			if (
				event.touches.length !== 1 ||
				touch.identifier !== swipe.identifier ||
				window.getSelection()?.isCollapsed === false
			) {
				cancel();
				return;
			}
			const dx = (touch.clientX - swipe.x) * (swipe.closing ? -1 : 1),
				dy = Math.abs(touch.clientY - swipe.y);
			if (!swipe.horizontal) {
				if (dx < -12 || (dy > 12 && dx <= dy * 1.5)) {
					cancel(); // Initial vertical or wrong-way intent cannot be reclaimed.
					return;
				}
				if (dx >= 12 && dx > dy * 1.5) swipe.horizontal = true;
			}
			if (swipe.horizontal) {
				if (!event.cancelable) {
					cancel();
					return;
				}
				// Keep consuming a claimed gesture even if it no longer completes.
				// Otherwise a short/reversed swipe can become a row click or scroll.
				event.preventDefault();
				swipe.canceled ||=
					dx < swipe.furthest - 12 || (dy > 12 && dy >= Math.abs(dx));
				swipe.furthest = Math.max(swipe.furthest, dx);
			}
		}
		function end(event: TouchEvent) {
			const completed = swipe;
			swipe = undefined;
			const touch = event.changedTouches[0];
			if (
				!completed?.horizontal ||
				!touch ||
				touch.identifier !== completed.identifier ||
				event.touches.length ||
				window.getSelection()?.isCollapsed === false
			)
				return;
			if (event.cancelable) event.preventDefault();
			compatibilityClick = {
				target: completed.target,
				until: performance.now() + 700,
			};
			const dx = (touch.clientX - completed.x) * (completed.closing ? -1 : 1),
				dy = Math.abs(touch.clientY - completed.y);
			if (
				!completed.canceled &&
				dx >= completed.furthest - 12 &&
				dx >= 64 &&
				dx > dy &&
				!!sidebar.current?.open === completed.closing
			) {
				if (completed.closing) closeSessions();
				else openSessions();
			}
		}
		function click(event: MouseEvent) {
			const guard = compatibilityClick;
			if (!guard || event.detail === 0) return;
			const capabilities = (
				event as MouseEvent & {
					sourceCapabilities?: { firesTouchEvents: boolean };
				}
			).sourceCapabilities;
			if (
				performance.now() > guard.until ||
				(!guard.backdrop &&
					(capabilities?.firesTouchEvents === false ||
						(event instanceof PointerEvent && event.pointerType === "mouse")))
			) {
				compatibilityClick = undefined;
				return;
			}
			if (event.target instanceof Node && guard.target.contains(event.target)) {
				compatibilityClick = undefined;
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		}
		function outsideDialog(event: PointerEvent) {
			const dialog = sidebar.current;
			if (!dialog?.open || dialog.dataset.closing || event.target !== dialog)
				return false;
			const bounds = dialog.getBoundingClientRect();
			return (
				event.clientX < bounds.left ||
				event.clientX > bounds.right ||
				event.clientY < bounds.top ||
				event.clientY > bounds.bottom
			);
		}
		function pointerDown(event: PointerEvent) {
			backdropTap = undefined;
			compatibilityClick = undefined;
			if (
				event.isPrimary &&
				event.button === 0 &&
				outsideDialog(event) &&
				window.getSelection()?.isCollapsed !== false
			)
				backdropTap = {
					pointer: event.pointerId,
					x: event.clientX,
					y: event.clientY,
				};
		}
		function pointerMove(event: PointerEvent) {
			if (
				backdropTap &&
				(event.pointerId !== backdropTap.pointer ||
					!outsideDialog(event) ||
					Math.hypot(
						event.clientX - backdropTap.x,
						event.clientY - backdropTap.y,
					) > 12)
			)
				backdropTap = undefined; // Drag/entry cancellation is latched.
		}
		function pointerUp(event: PointerEvent) {
			pointerMove(event);
			const tap = backdropTap;
			backdropTap = undefined;
			if (!tap || window.getSelection()?.isCollapsed === false) return;
			// Consume the compatibility click even when reduced motion closes immediately.
			compatibilityClick = {
				target: node!,
				until: performance.now() + 700,
				backdrop: true,
			};
			closeSessions();
		}
		function cancelPointer() {
			backdropTap = undefined;
		}
		function cancelTouch() {
			cancelPointer();
			cancel();
		}
		node.addEventListener("touchstart", start, { passive: true });
		node.addEventListener("touchmove", move, { passive: false });
		node.addEventListener("touchend", end, { passive: false });
		node.addEventListener("touchcancel", cancelTouch, { passive: true });
		node.addEventListener("pointermove", pointerMove, true);
		node.addEventListener("pointerup", pointerUp, true);
		node.addEventListener("pointercancel", cancelPointer, true);
		node.addEventListener("click", click, true);
		node.addEventListener("pointerdown", pointerDown, true);
		return () => {
			cancelTouch();
			node.removeEventListener("touchstart", start);
			node.removeEventListener("touchmove", move);
			node.removeEventListener("touchend", end);
			node.removeEventListener("touchcancel", cancelTouch);
			node.removeEventListener("pointermove", pointerMove, true);
			node.removeEventListener("pointerup", pointerUp, true);
			node.removeEventListener("pointercancel", cancelPointer, true);
			node.removeEventListener("click", click, true);
			node.removeEventListener("pointerdown", pointerDown, true);
		};
	}, [paired]);
	function dismissSessions() {
		sidebarMotion.current++;
		sidebar.current?.close();
	}
	function cancelSessions(event: SyntheticEvent<HTMLDialogElement>) {
		event.preventDefault();
		closeSessions();
	}
	function restoreSessionFocus() {
		if (!sidebar.current?.open) sessionsToggle.current?.focus();
	}
	return {
		app,
		sidebar,
		sessionsToggle,
		openSessions,
		closeSessions,
		dismissSessions,
		cancelSessions,
		restoreSessionFocus,
	};
}
