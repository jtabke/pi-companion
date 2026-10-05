import React, { useEffect, useRef, useState } from "react";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";

/** Image viewing only; the caller owns the source and any send/remove actions. */
export function ImagePreview({
	src,
	alt,
	label,
	className,
	width,
	height,
	loading,
}: {
	src: string;
	alt: string;
	label: string;
	className: string;
	width?: number;
	height?: number;
	loading?: "lazy";
}) {
	const [loadedSource, setLoadedSource] = useState<string>();
	const [failedSource, setFailedSource] = useState<string>();
	const image = useRef<HTMLImageElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const viewer = useRef<PhotoSwipe | null>(null);
	useEffect(() => () => viewer.current?.destroy(), [src]);
	function enlarge() {
		const img = image.current;
		if (!img?.naturalWidth || !img.naturalHeight) return;
		const pswp = new PhotoSwipe({
			dataSource: [
				{
					src,
					width: width ?? img.naturalWidth,
					height: height ?? img.naturalHeight,
					alt: `${alt} enlarged`,
				},
			],
			index: 0,
			// Fit the viewport even for small screenshots; zoom remains available.
			initialZoomLevel: (level) =>
				level.panAreaSize
					? Math.min(
							level.panAreaSize.x / (width ?? img.naturalWidth),
							level.panAreaSize.y / (height ?? img.naturalHeight),
						)
					: level.fit,
			showHideAnimationType: "none",
			loop: false,
			returnFocus: false,
		});
		viewer.current = pswp;
		pswp.on("destroy", () => {
			viewer.current = null;
			if (button.current?.isConnected)
				button.current.focus({ preventScroll: true });
		});
		pswp.init();
	}
	return failedSource === src ? (
		<p role="status">{alt} unavailable</p>
	) : (
		<button
			ref={button}
			type="button"
			className={className}
			aria-label={label}
			disabled={loadedSource !== src}
			onClick={enlarge}
		>
			<img
				ref={image}
				src={src}
				width={width}
				height={height}
				alt={alt}
				loading={loading}
				onLoad={() => setLoadedSource(src)}
				onError={() => setFailedSource(src)}
			/>
		</button>
	);
}
