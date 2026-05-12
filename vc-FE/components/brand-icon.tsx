import { cn } from "@/lib/utils";

/** Techerudite mark from `public/icon.png` */
export function BrandIcon({ className }: { className?: string }) {
  return (
    <img
      src="/icon.png"
      alt=""
      decoding="async"
      className={cn("object-contain pointer-events-none select-none", className)}
    />
  );
}
