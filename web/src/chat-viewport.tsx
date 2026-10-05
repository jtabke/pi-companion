import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Owns chat scrolling only; navigation and input authority stay in App. */
type ReadingPosition = { top: number; following: boolean };
type ReviewAnchor = ReadingPosition & { invocations: string[] };
export function ChatViewport({
	children,
	owner,
	review,
	pending,
}: {
	children: ReactNode;
	owner: string;
	review: number;
	pending?: string[];
}) {
	const viewport = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const lastScrollTop = useRef(0);
	const returningToBottom = useRef(false);
	const jumping = useRef(false);
	const observedUsers = useRef<{ owner: string; ids: Set<string> } | undefined>(
		undefined,
	);
	const scrollbarStart = useRef<number | undefined>(undefined);
	const touch = useRef<{ x: number; y: number; moved: boolean } | undefined>(
		undefined,
	);
	const [away, setAway] = useState(false);
	// Bounded view positions only: no transcript, media, or browser storage.
	const positions = useRef(
		new Map<string, ReadingPosition & { anchor?: ReviewAnchor }>(),
	);
	const activeOwner = useRef(owner);
	const reviewAnchor = useRef<ReviewAnchor | undefined>(undefined);
	const preserveResize = useRef(false);
	const pendingKey = pending?.join(":");
	function remember() {
		if (!activeOwner.current) return;
		positions.current.set(activeOwner.current, {
			top: lastScrollTop.current,
			following: following.current,
			anchor: reviewAnchor.current,
		});
	}
	function restoreClosedReview(keepReading = false) {
		const node = viewport.current,
			anchor = reviewAnchor.current;
		if (
			!node ||
			activeOwner.current !== owner ||
			!anchor ||
			pending === undefined ||
			anchor.invocations.some((invocation) => pending.includes(invocation))
		)
			return false;
		// Keep the existing anchor pending during touch; release rechecks current identity/closure.
		if (touch.current) return false;
		reviewAnchor.current = undefined;
		returningToBottom.current = false;
		if (!keepReading) {
			following.current = anchor.following;
			node.scrollTop = anchor.following ? node.scrollHeight : anchor.top;
		}
		lastScrollTop.current = node.scrollTop;
		preserveResize.current = false;
		remember();
		return true;
	}
	function endTouch(cancelled = false) {
		const moved = touch.current?.moved ?? false;
		touch.current = undefined;
		if (cancelled) returningToBottom.current = false;
		if (!restoreClosedReview(moved)) resumeAtBottom();
		remember();
		measure();
	}
	function startReview() {
		cancelJump();
		if (touch.current) touch.current.moved = false;
		// A fresh Review never inherits deferred work for already closed invocations.
		if (
			pending !== undefined &&
			reviewAnchor.current &&
			!reviewAnchor.current.invocations.some((invocation) =>
				pending.includes(invocation),
			)
		)
			reviewAnchor.current = undefined;
		returningToBottom.current = false;
		if (!reviewAnchor.current && pending?.length)
			reviewAnchor.current = {
				top: lastScrollTop.current,
				following: following.current,
				invocations: [...pending],
			};
		following.current = false;
		remember();
	}
	function disclose(target: Element) {
		const summary = target.closest("summary");
		if (!summary && !target.closest("button.image")) return;
		cancelJump();
		if (summary?.parentElement?.id === "question-review") startReview();
		else {
			returningToBottom.current = false;
			following.current = false;
			remember();
		}
	}
	function measure() {
		const node = viewport.current;
		if (!node) return;
		const distance = node.scrollHeight - node.clientHeight - node.scrollTop;
		const panel = node.querySelector<HTMLDetailsElement>("#question-review");
		const bounds = node.getBoundingClientRect(),
			questionBounds = panel?.getBoundingClientRect();
		const reviewingVisible =
			panel?.open &&
			questionBounds &&
			questionBounds.top < bounds.bottom &&
			questionBounds.bottom > bounds.top;
		setAway(distance > 64 && !reviewingVisible && !jumping.current);
	}
	function cancelJump() {
		if (!jumping.current) return;
		jumping.current = false;
		const node = viewport.current;
		if (node) node.scrollTo({ top: node.scrollTop, behavior: "instant" });
		measure();
	}
	function scrollIntent(towardBottom: boolean) {
		cancelJump();
		returningToBottom.current = towardBottom;
		following.current = false;
		remember();
	}
	function resumeAtBottom() {
		const node = viewport.current!;
		if (
			returningToBottom.current &&
			!touch.current &&
			node.scrollHeight - node.clientHeight - node.scrollTop <= 1
		)
			following.current = true;
	}
	function latest() {
		const node = viewport.current;
		if (!node) return;
		const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
		jumping.current = smooth;
		returningToBottom.current = smooth;
		following.current = !smooth;
		node.scrollTo({
			top: node.scrollHeight,
			behavior: smooth ? "smooth" : "instant",
		});
		lastScrollTop.current = node.scrollTop;
		remember();
		measure();
	}
	useLayoutEffect(() => {
		const node = viewport.current;
		if (!node) return;
		cancelJump();
		activeOwner.current = owner;
		returningToBottom.current = false;
		touch.current = undefined;
		scrollbarStart.current = undefined;
		// A replacement generation is never restored from the old owner's position.
		const instance = owner.split(":")[0];
		for (const key of positions.current.keys())
			if (key.split(":")[0] === instance && key !== owner)
				positions.current.delete(key);
		const saved = positions.current.get(owner);
		positions.current.delete(owner);
		reviewAnchor.current = saved?.anchor;
		following.current = saved?.following ?? true;
		node.scrollTop = following.current ? node.scrollHeight : (saved?.top ?? 0);
		lastScrollTop.current = node.scrollTop;
		remember();
		while (positions.current.size > 16)
			positions.current.delete(positions.current.keys().next().value!);
		measure();
	}, [owner]);
	useLayoutEffect(() => {
		const users = content.current?.querySelectorAll<HTMLElement>(
			".message-user[data-native-item]",
		);
		if (!users) return;
		const previous = observedUsers.current;
		observedUsers.current = {
			owner,
			ids: new Set([...users].map((node) => node.dataset.nativeItem!)),
		};
		if (
			previous?.owner !== owner ||
			!following.current ||
			touch.current ||
			!viewport.current?.clientHeight ||
			matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		for (const node of users) {
			if (!previous.ids.has(node.dataset.nativeItem!))
				node.animate(
					[
						{ opacity: 0.6, transform: "translateY(8px)" },
						{ opacity: 1, transform: "translateY(0)" },
					],
					{ duration: 180, easing: "ease-out" },
				);
		}
	}, [children, owner]);
	useLayoutEffect(() => {
		const node = viewport.current;
		if (!node || pending === undefined) return; // Missing/disconnected observation is not closure.
		if (!restoreClosedReview()) {
			// Arrival invites Review without moving the reader, even when following latest.
			lastScrollTop.current = node.scrollTop;
			preserveResize.current = true;
		}
		measure();
	}, [owner, pendingKey]);
	useLayoutEffect(() => {
		const node = viewport.current,
			panel = node?.querySelector<HTMLDetailsElement>("#question-review");
		if (!review || !panel || !node) return;
		startReview();
		panel.open = true;
		panel.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
		node.scrollTop +=
			panel.getBoundingClientRect().top -
			node.getBoundingClientRect().top -
			node.clientTop;
		lastScrollTop.current = node.scrollTop;
		remember();
		measure();
	}, [review]);
	useLayoutEffect(() => {
		const node = viewport.current,
			body = content.current;
		if (!node || !body) return;
		const observer = new ResizeObserver(() => {
			if (following.current && !touch.current && !preserveResize.current) {
				node.scrollTop = node.scrollHeight;
				lastScrollTop.current = node.scrollTop;
			}
			preserveResize.current = false;
			remember();
			measure();
		});
		observer.observe(node);
		observer.observe(body);
		return () => observer.disconnect();
	}, []);
	return (
		<div className="chat-frame">
			<div
				className="chat-scroll"
				ref={viewport}
				tabIndex={0}
				role="region"
				aria-label="Conversation history"
				onMouseDownCapture={(event) => {
					const node = event.currentTarget;
					// Native scrollbar presses target the viewport itself, including overlay bars.
					if (event.button !== 0 || event.target !== node) return;
					scrollbarStart.current = node.scrollTop;
					scrollIntent(false);
				}}
				onMouseUpCapture={() => {
					const start = scrollbarStart.current;
					if (start === undefined) return;
					scrollbarStart.current = undefined;
					returningToBottom.current = viewport.current!.scrollTop >= start;
					resumeAtBottom();
					returningToBottom.current = false;
					remember();
				}}
				onClickCapture={(event) => disclose(event.target as Element)}
				onKeyDownCapture={(event) => {
					if (event.key === "Enter" || event.key === " ")
						disclose(event.target as Element);
					if (
						event.target === event.currentTarget &&
						[
							"ArrowUp",
							"ArrowDown",
							"PageUp",
							"PageDown",
							"Home",
							"End",
							" ",
						].includes(event.key)
					)
						scrollIntent(
							["ArrowDown", "PageDown", "End"].includes(event.key) ||
								(event.key === " " && !event.shiftKey),
						);
				}}
				onWheelCapture={(event) => {
					if (event.deltaY && !event.ctrlKey) {
						scrollIntent(event.deltaY > 0);
						if (event.deltaY > 0) resumeAtBottom();
					}
				}}
				onTouchStartCapture={(event) => {
					cancelJump();
					const point = event.touches[0];
					returningToBottom.current = false;
					if (point)
						touch.current = {
							x: point.clientX,
							y: point.clientY,
							moved: false,
						};
				}}
				onTouchMoveCapture={(event) => {
					const point = event.touches[0],
						previous = touch.current;
					if (!point || !previous) return;
					const vertical =
						event.touches.length === 1 &&
						point.clientY !== previous.y &&
						Math.abs(point.clientY - previous.y) >=
							Math.abs(point.clientX - previous.x);
					if (vertical) scrollIntent(point.clientY < previous.y);
					touch.current = {
						x: point.clientX,
						y: point.clientY,
						moved: previous.moved || vertical,
					};
				}}
				onTouchEndCapture={(event) => {
					if (!event.touches.length) endTouch();
				}}
				onTouchCancelCapture={() => endTouch(true)}
				onScroll={() => {
					// Scroll events also come from layout, restoration and Review, not just input.
					lastScrollTop.current = viewport.current!.scrollTop;
					remember();
					measure();
				}}
				onScrollEnd={() => {
					// Output may arrive during a deliberate jump; follow it only after motion ends.
					if (jumping.current) {
						jumping.current = false;
						following.current = true;
						viewport.current!.scrollTop = viewport.current!.scrollHeight;
						lastScrollTop.current = viewport.current!.scrollTop;
					} else resumeAtBottom();
					returningToBottom.current = false;
					remember();
					measure();
				}}
			>
				<div className="chat-content" ref={content}>
					{children}
				</div>
			</div>
			{away && owner && (
				<button
					className="jump-latest"
					aria-label="Jump to latest"
					onMouseDown={(event) => {
						// Keep editing focus until native click. Keyboard closure would
						// move this button before release, losing the user's tap.
						if (
							event.button === 0 &&
							document.activeElement instanceof HTMLTextAreaElement
						)
							event.preventDefault();
					}}
					onClick={latest}
				>
					<svg
						aria-hidden="true"
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M12 5v14m-6-6 6 6 6-6" />
					</svg>
				</button>
			)}
		</div>
	);
}
