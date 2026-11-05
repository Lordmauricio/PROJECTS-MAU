"use client";
import { useId, type ComponentProps } from "react";

export default function FieldInput({
  label,
  id,
  className = "",
  ...props
}: ComponentProps<"input"> & { label: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="min-w-0 space-y-1">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-zinc-700"
      >
        {label}
      </label>
      <input {...props} id={inputId} className={`block w-full ${className}`} />
    </div>
  );
}
