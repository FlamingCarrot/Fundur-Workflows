/** A screenshot of the app pinned on the page like a sample card, with a dark-mode version when there is one. */
export function Shot({
  src,
  darkSrc,
  width,
  height,
  alt,
  priority = false,
  className = "",
}: {
  src: string;
  darkSrc?: string;
  width: number;
  height: number;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <figure className={`site-shot ${className}`}>
      <picture>
        {darkSrc && <source srcSet={darkSrc} media="(prefers-color-scheme: dark)" />}
        {/* Plain images: these are small, pre-sized WebP files, and <picture> picks the theme's version. */}
        <img
          src={src}
          width={width}
          height={height}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
        />
      </picture>
    </figure>
  );
}
