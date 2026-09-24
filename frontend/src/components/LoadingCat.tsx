import catGif from "../assets/loading-cat.gif";
import catSmGif from "../assets/loading-cat-sm.gif";
import catWebp from "../assets/loading-cat.webp";

type Props = {
  label?: string;
  size?: "sm" | "md" | "lg";
  layout?: "inline" | "block";
};

export default function LoadingCat({ label, size = "md", layout = "inline" }: Props) {
  const gif = size === "sm" ? catSmGif : catGif;
  const sizeClass = size === "md" ? "" : ` ${size}`;
  return (
    <span className={`loading-cat${sizeClass}${layout === "block" ? " block" : ""}`} role="status">
      <picture>
        <source srcSet={catWebp} type="image/webp" />
        <img src={gif} alt="" />
      </picture>
      {label ? <span className="loading-cat-label">{label}</span> : null}
    </span>
  );
}
