import type { ComponentProps } from "react";
import { cn } from "#lib/format";

// Primary is for the one action a view is about (search); there should be at
// most one on screen. Secondary for everything else, quiet for actions that
// sit inside content, like showing an episode's sections.
const variants = {
  primary: "bg-accent text-on-accent hover:bg-accent/90",
  secondary: "border border-rule bg-surface text-ink hover:border-ink/40",
  quiet: "text-accent hover:bg-accent-wash",
} as const;

const sizes = {
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-base",
  lg: "h-12 gap-2 px-6 text-lg",
} as const;

export const buttonClass = (variant: keyof typeof variants = "secondary", size: keyof typeof sizes = "md") =>
  cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-control font-medium whitespace-nowrap no-underline transition-colors duration-150 disabled:cursor-default disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:size-[1.1em]",
    variants[variant],
    sizes[size],
  );

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  // oxlint-disable-next-line react/button-has-type -- type defaults to "button"
  return <button type={type} className={cn(buttonClass(variant, size), className)} {...props} />;
}

// A square button with only an icon, so it must be labelled.
export function IconButton({
  label,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      // oxlint-disable-next-line react/button-has-type -- type defaults to "button"
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink [&_svg]:size-[1.15rem]",
        className,
      )}
      {...props}
    />
  );
}
