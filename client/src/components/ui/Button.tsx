import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({ children, variant = "primary", size = "md", className, ...props }) => {
  const variantClass = variant === "primary" ? "btn-primary" : "btn-secondary";

  const sizeClass = size === "sm" ? "px-2 py-1 text-xs" : size === "lg" ? "px-6 py-3 text-base" : "px-4 py-2 text-sm";

  return (
    <button
      className={`
        ${variantClass}
        ${sizeClass}
        ${className || ""}
        inline-flex items-center justify-center gap-2
      `}
      {...props}
    >
      {children}
    </button>
  );
};
