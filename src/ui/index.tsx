import { Children, cloneElement, isValidElement, useId, useState, type ReactNode, type InputHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Button as ShadButton } from '@/components/ui/button';
import { Card as ShadCard } from '@/components/ui/card';
import { Input as ShadInput } from '@/components/ui/input';
import { Select as ShadSelect, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

// Thin wrappers over shadcn/ui, the same primitives the farmer app uses, sized for a laptop.

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, 'default' | 'outline' | 'ghost' | 'destructive'> = {
  primary: 'default', secondary: 'outline', ghost: 'ghost', danger: 'destructive',
};

export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <ShadButton
      variant={VARIANT[variant]}
      className={cn(
        'h-10 px-4 rounded-[var(--radius-ctl)] text-[15px] font-semibold',
        variant === 'secondary' && 'border-line-strong text-ink',
        variant === 'ghost' && 'text-ink-2 hover:text-ink',
        variant === 'danger' && 'bg-transparent text-loss hover:bg-loss-soft',
        className,
      )}
      {...p}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ShadCard className={cn('block flex-row gap-0 py-0 overflow-visible rounded-[var(--radius-card)] bg-ground text-[16px] ring-0 border border-line', className)}>
      {children}
    </ShadCard>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  const generatedId = useId();
  const first = Children.toArray(children).find(child => isValidElement<{ id?: string }>(child));
  const id = isValidElement<{ id?: string }>(first) ? first.props.id ?? generatedId : generatedId;
  return (
    <div className={cn('flex flex-col items-stretch gap-0 font-normal text-[16px] min-w-0', className)} role="group" aria-labelledby={`${id}-label`}>
      <Label id={`${id}-label`} htmlFor={id} className="font-medium text-[13px] text-ink-2 mb-1">{label}</Label>
      {Children.map(children, child => isValidElement<{ id?: string; 'aria-label'?: string; 'aria-describedby'?: string }>(child)
        ? cloneElement(child, { id: child.props.id ?? id, 'aria-label': child.props['aria-label'] ?? label, 'aria-describedby': [child.props['aria-describedby'], hint ? `${id}-hint` : undefined].filter(Boolean).join(' ') || undefined }) : child)}
      {hint && <span id={`${id}-hint`} className="mt-1 text-[13px] text-ink-3 leading-snug">{hint}</span>}
    </div>
  );
}

/** Text input with optional prefix ($) and suffix (unit). Numbers are right aligned. */
export function Input({ prefix, suffix, numeric, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { prefix?: string; suffix?: string; numeric?: boolean }) {
  return (
    <span className={cn('flex items-stretch h-10 rounded-[var(--radius-ctl)] border border-line-strong bg-ground overflow-hidden focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/25', className)}>
      {prefix && <span className="flex items-center pl-3 pr-1 text-ink-3 text-[15px]">{prefix}</span>}
      <ShadInput
        className={cn('h-full flex-1 min-w-0 rounded-none border-0 px-3 text-[15px] md:text-[15px] focus-visible:ring-0 focus-visible:border-0', numeric && 'text-right tnum', prefix && 'pl-1')}
        inputMode={numeric ? 'decimal' : undefined}
        {...p}
      />
      {suffix && <span className="flex items-center px-3 text-ink-2 text-[14px] bg-well border-l border-line whitespace-nowrap">{suffix}</span>}
    </span>
  );
}

/** Keeps the user's in-progress decimal text while editing; commits finite numbers. */
export function NumberInput({ value, onChange, step, plain, min = 0, onFocus, onBlur, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null; onChange: (n: number | null) => void; prefix?: string; suffix?: string; step?: number; plain?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown = value === null || !Number.isFinite(value) ? '' : (plain || (step && step < 1) ? value.toString() : value.toLocaleString('en-US'));
  return <Input numeric {...p} min={min} value={editing ?? shown}
    onFocus={e => { setEditing(value === null ? '' : value.toString()); onFocus?.(e); }}
    onBlur={e => { setEditing(null); onBlur?.(e); }}
    onChange={e => {
      const raw = e.target.value.replace(/,/g, '');
      if (!/^-?\d*\.?\d*$/.test(raw)) return;
      setEditing(raw);
      if (raw === '' || raw === '-' || raw === '.') { onChange(null); return; }
      const n = Number(raw);
      if (Number.isFinite(n) && n >= Number(min)) onChange(n);
    }} />;
}

export interface SelectOption { value: string; label: ReactNode; group?: string }

/** Select built on shadcn/Radix with optional grouping. */
export function Select({ value, onChange, options, className, placeholder, id, 'aria-label': ariaLabel, disabled }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; className?: string; placeholder?: string; id?: string; 'aria-label'?: string; disabled?: boolean;
}) {
  const groups = new Map<string | undefined, SelectOption[]>();
  for (const o of options) { const g = groups.get(o.group) ?? []; g.push(o); groups.set(o.group, g); }
  return (
    <ShadSelect value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('h-10 w-full rounded-[var(--radius-ctl)] border-line-strong bg-ground px-3 text-[15px] data-[size=default]:h-10 focus-visible:border-accent focus-visible:ring-accent/25', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[420px]">
        {[...groups.entries()].map(([g, items]) => (
          <SelectGroup key={g ?? '_'}>
            {g && <SelectLabel className="text-[12px] text-ink-3">{g}</SelectLabel>}
            {items.map(o => <SelectItem key={o.value} value={o.value} className="text-[15px] py-2">{o.label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

/** Whole dollars with a real minus sign, the way the study tables print them (no dollar sign inside a table). */
export const num0 = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const pct = (n: number, digits = 1) => `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: digits })}%`;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (p: string) => { const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1] ?? m} ${y}`; };
