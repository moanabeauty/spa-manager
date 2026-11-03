"use client";

import { useEffect, useState } from "react";
import { formatNumber, parseVnd } from "@/lib/billing";

/** Ô nhập tiền: gõ 1500000, 1.500.000, 1500k hoặc 1,5tr đều được */
export default function MoneyInput({
  value,
  onChange,
  className = "",
  placeholder = "0",
  disabled,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value ? formatNumber(value) : "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value ? formatNumber(value) : "");
  }, [value, focused]);

  return (
    <input
      inputMode="numeric"
      aria-label={ariaLabel}
      className={`rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-right text-sm outline-none focus:border-navy disabled:bg-cream disabled:text-ink/50 ${className}`}
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const n = parseVnd(text);
        if (Number.isNaN(n)) setText(value ? formatNumber(value) : "");
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseVnd(e.target.value);
        if (!Number.isNaN(n)) onChange(Math.max(0, n));
      }}
    />
  );
}
