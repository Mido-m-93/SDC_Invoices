"use client";
// src/components/ui/Button.tsx

import clsx from "clsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-[#2d6a4f] text-white hover:bg-[#245a41] border border-[#2d6a4f] shadow-sm",
  secondary:
    "bg-white text-stone-700 hover:bg-stone-50 border border-stone-200 shadow-sm",
  ghost:
    "bg-transparent text-stone-600 hover:bg-stone-100 border border-transparent",
  danger:
    "bg-red-600 text-white hover:bg-red-700 border border-red-600 shadow-sm",
};

const sizeClasses: Record<Size, string> = {
  sm: "text-xs px-3 py-1.5 rounded-lg gap-1.5",
  md: "text-sm px-4 py-2 rounded-lg gap-2",
  lg: "text-sm px-5 py-2.5 rounded-xl gap-2",
};

export default function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  children,
  disabled,
  className,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d6a4f] focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {loading ? (
        <SpinnerIcon />
      ) : icon ? (
        <span className="flex-shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
