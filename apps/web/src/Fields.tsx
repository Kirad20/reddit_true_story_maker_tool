import { useEffect, useState, type InputHTMLAttributes } from "react";

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max">;

/**
 * Text input bound to a list ("a, b, c"). It keeps the raw text the user types, so separators
 * (commas, spaces) are not swallowed while typing; the parsed list goes to onChange on every key.
 * The text is only rebuilt when the list changes from outside (load, save, reset).
 */
export function ListInput({
  value,
  onChange,
  separator = /\s*,\s*/,
  normalize = (x) => x.trim(),
  joiner = ", ",
  ...rest
}: BaseProps & {
  value: string[];
  onChange: (list: string[]) => void;
  separator?: RegExp;
  normalize?: (item: string) => string;
  joiner?: string;
}) {
  const parse = (text: string) => text.split(separator).map(normalize).filter(Boolean);
  const [text, setText] = useState(() => value.join(joiner));

  useEffect(() => {
    setText((current) => (sameList(parse(current), value) ? current : value.join(joiner)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.join("\u0000")]);

  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const list = parse(e.target.value);
        if (!sameList(list, value)) onChange(list);
      }}
      onBlur={(e) => {
        setText(value.join(joiner));
        rest.onBlur?.(e);
      }}
    />
  );
}

/**
 * Number input that can be cleared and retyped: the raw text is kept while editing and only valid
 * numbers reach onChange. On blur an empty or out-of-range value snaps back into [min, max].
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  ...rest
}: BaseProps & { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText((current) => (current.trim() !== "" && Number(current) === value ? current : String(value)));
  }, [value]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.valueAsNumber;
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
      onBlur={(e) => {
        const n = Number(text);
        const next = text.trim() === "" || !Number.isFinite(n) ? value : clamp(n);
        if (next !== value) onChange(next);
        setText(String(next));
        rest.onBlur?.(e);
      }}
    />
  );
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
