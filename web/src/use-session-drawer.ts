import { useEffect, useRef, type SyntheticEvent } from "react";

/** Native dialog motion, gestures and focus restoration; no session or input authority. */
export function useSessionDrawer(paired: boolean) {
	const app = useRef<HTMLElement>(null);
	const sidebar = useRef<HTMLDialogElement>(null);
	const sessionsToggle = useRef<HTMLButtonElement>(null);
	const sidebarMotion = useRef(0);
	function settleSessions(open: boolean, velocity?: number) {
		const dialog = sidebar.current;
		if (
			!dialog ||
			(open
				? dialog.open && !dialog.dataset.dragging
				: !dialog.open || dialog.dataset.closing)
		)
			return;
		const motion = ++sidebarMotion.current;
		if (dialog.open) {
			// Settle from the rendered position, including interrupted entry or drag.
			dialog.style.setProperty(
				"--session-offset",
				getComputedStyle(dialog).transform,
			);
			dialog.style.setProperty(
				"--session-shade",
				getComputedStyle(dialog, "::backdrop").opacity,
			);
		} else {
			dialog.style.removeProperty("--session-offset");
			dialog.style.removeProperty("--session-shade");
		}
		if (velocity !== undefined) {
			const bounds = dialog.getBoundingClientRect();
			const distance = open ? -bounds.x : bounds.width + bounds.x;
			const duration = Math.min(
				300,
				Math.max(80, distance / Math.max(0.8, Math.abs(velocity))),
			);
			dialog.style.setProperty("--session-duration", `${duration}ms`);
		} else dialog.style.removeProperty("--session-duration");
		delete dialog.dataset.dragging;
		dialog.style.removeProperty("--session-drag-x");
		dialog.style.removeProperty("--session-drag-shade");
		if (open) {
			delete dialog.dataset.closing;
			if (!dialog.open) dialog.showModal();
			return;
		}
		dialog.dataset.closing = "true";
		const animations = dialog.getAnimations({ subtree: true });
		const finish = () => {
			if (
				sidebarMotion.current === motion &&
				sidebar.current === dialog &&
				dialog.open
			) {
				dialog.close();
				dialog.style.removeProperty("--session-offset");
				dialog.style.removeProperty("--session-shade");
				dialog.style.removeProperty("--session-duration");
			}
		};
		if (!animations.length)
			finish(); // Reduced motion closes synchronously.
		else
			void Promise.all(animations.map((animation) => animation.finished)).then(
				finish,
				finish,
			);
	}
	function openSessions() {
		settleSessions(true);
	}
	function closeSessions() {
		settleSessions(false);
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
		type Drag = {
			width: number;
			origin: number;
			startX: number;
			motion: number;
			lastX: number;
			lastTime: number;
			velocity: number;
		};
		let swipe:
			| {
					x: number;
					y: number;
					started: number;
					identifier: number;
					drag?: Drag;
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
			const canceled = swipe;
			swipe = undefined;
			if (canceled?.drag?.motion === sidebarMotion.current)
				settleSessions(canceled.closing, 0);
			compatibilityClick = undefined;
		}
		function placeDrag(drag: Drag, x: number) {
			const dialog = sidebar.current;
			if (!dialog || drag.motion !== sidebarMotion.current) return;
			const offset = Math.max(
				-drag.width,
				Math.min(0, drag.origin + x - drag.startX),
			);
			dialog.style.setProperty("--session-drag-x", `${offset}px`);
			dialog.style.setProperty(
				"--session-drag-shade",
				`${1 + offset / drag.width}`,
			);
		}
		function start(event: TouchEvent) {
			cancel(); // A new deliberate touch must never inherit click suppression.
			if (event.touches.length !== 1) backdropTap = undefined;
			const target = event.target instanceof Element ? event.target : undefined;
			const closing = !!sidebar.current?.open;
			const control = target?.closest("button, a, summary");
			const targetDialog = target?.closest("dialog");
			const composerHandle = !!target?.closest(".composer-drawer-handle");
			const sessionTarget = control?.matches(
				".session-card > button:not(.rename-session), .session-details > summary",
			);
			if (
				!matchMedia("(max-width: 639px)").matches ||
				(sidebar.current?.open && sidebar.current.dataset.closing) ||
				event.touches.length !== 1 ||
				!target ||
				(targetDialog && targetDialog !== sidebar.current) ||
				(control && !composerHandle && !(closing && sessionTarget)) ||
				(!composerHandle &&
					target.closest(
						"input, textarea, select, label, [contenteditable]:not([contenteditable=false]), pre, code, table, .image, .composer, .questions",
					)) ||
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
				if (!composerHandle && (touch.clientX < 0 || touch.clientX > 44))
					return;
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
				started: event.timeStamp,
				identifier: touch.identifier,
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
			if (!swipe.drag) {
				if (dx < -12 || (dy > 12 && dy > Math.abs(dx) * 1.5)) {
					cancel(); // Clear vertical or wrong-way intent cannot be reclaimed.
					return;
				}
				if (dx < 12 || dx <= dy * 1.5) return;
				const dialog = sidebar.current;
				if (!event.cancelable || !dialog) {
					cancel();
					return;
				}
				const origin = swipe.closing ? dialog.getBoundingClientRect().x : 0;
				delete dialog.dataset.closing;
				dialog.dataset.dragging = "true";
				dialog.style.setProperty(
					"--session-drag-x",
					swipe.closing ? `${origin}px` : "-100%",
				);
				dialog.style.setProperty(
					"--session-drag-shade",
					swipe.closing ? "1" : "0",
				);
				const motion = ++sidebarMotion.current;
				if (!dialog.open) dialog.showModal();
				const width = dialog.getBoundingClientRect().width;
				swipe.drag = {
					width,
					origin: swipe.closing ? origin : -width,
					startX: swipe.x,
					motion,
					lastX: swipe.x,
					lastTime: swipe.started,
					velocity: 0,
				};
			}
			if (!event.cancelable) {
				cancel();
				return;
			}
			// Consume claimed movement, including reversal, without turning it into a row click.
			event.preventDefault();
			swipe.canceled ||=
				dx < swipe.furthest - 12 || (dy > 12 && dy >= Math.abs(dx));
			swipe.furthest = Math.max(swipe.furthest, dx);
			const drag = swipe.drag;
			const elapsed = event.timeStamp - drag.lastTime;
			if (elapsed > 0) drag.velocity = (touch.clientX - drag.lastX) / elapsed;
			drag.lastX = touch.clientX;
			drag.lastTime = event.timeStamp;
			placeDrag(drag, touch.clientX);
		}
		function end(event: TouchEvent) {
			const completed = swipe;
			swipe = undefined;
			if (!completed?.drag || completed.drag.motion !== sidebarMotion.current)
				return;
			const touch = event.changedTouches[0];
			if (
				!touch ||
				touch.identifier !== completed.identifier ||
				event.touches.length ||
				window.getSelection()?.isCollapsed === false
			) {
				settleSessions(completed.closing, 0);
				return;
			}
			if (event.cancelable) event.preventDefault();
			compatibilityClick = {
				target: completed.target,
				until: performance.now() + 700,
			};
			placeDrag(completed.drag, touch.clientX);
			const dx = (touch.clientX - completed.x) * (completed.closing ? -1 : 1);
			const dy = Math.abs(touch.clientY - completed.y);
			const changed =
				!completed.canceled &&
				dx >= completed.furthest - 12 &&
				dx >= 64 &&
				dx > dy;
			// A pause before release is not a fling. Speed only controls remaining motion.
			const velocity =
				event.timeStamp - completed.drag.lastTime <= 100
					? completed.drag.velocity
					: 0;
			settleSessions(
				changed ? !completed.closing : completed.closing,
				velocity,
			);
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
