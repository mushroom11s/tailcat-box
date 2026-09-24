import catGif from "../assets/loading-cat.gif";
import catSmGif from "../assets/loading-cat-sm.gif";
import catWebp from "../assets/loading-cat.webp";

type Props = {
  label?: string;
  size?: "sm" | "md";
  layout?: "inline" | "block";
};

export default function LoadingCat({ label, size = "md", layout = "inline" }: Props) {
  const gif = size === "sm" ? catSmGif : catGif;
  return (
    <span className={`loading-cat${size === "sm" ? " sm" : ""}${layout === "block" ? " block" : ""}`} role="status">
      <picture>
        <source srcSet={catWebp} type="image/webp" />
        <img src={gif} alt="" />
      </picture>
      {label ? <span className="loading-cat-label">{label}</span> : null}
    </span>
  );
}
