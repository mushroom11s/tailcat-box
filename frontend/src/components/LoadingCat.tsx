import catUrl from "../assets/loading-cat.gif";
import catSmUrl from "../assets/loading-cat-sm.gif";

type Props = {
  label?: string;
  size?: "sm" | "md";
  layout?: "inline" | "block";
};

export default function LoadingCat({ label, size = "md", layout = "inline" }: Props) {
  const src = size === "sm" ? catSmUrl : catUrl;
  return (
    <span className={`loading-cat${size === "sm" ? " sm" : ""}${layout === "block" ? " block" : ""}`} role="status">
      <img src={src} alt="" />
      {label ? <span className="loading-cat-label">{label}</span> : null}
    </span>
  );
}
