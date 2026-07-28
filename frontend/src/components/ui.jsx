import { forwardRef } from 'react';
import { Loader2, X, AlertTriangle, Inbox } from 'lucide-react';

// Shared, deliberately small set of UI atoms so every page (Dashboard,
// Organizations, People, Calendars, ...) looks like one product instead of
// each reinventing buttons/cards/tables. Design tokens come straight from
// tailwind.config.js / CLAUDE.md (Ink navy, Signal Amber accent).

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`bg-card rounded-xl border border-line shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-4 sm:px-8 py-6 border-b border-line bg-card">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-bold text-ink">{title}</h1>
        {description && <p className="text-sm text-muted mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary: 'bg-ink text-white hover:bg-inkdeep disabled:opacity-50',
  accent: 'bg-signal-amber text-ink hover:brightness-95 disabled:opacity-50',
  secondary: 'bg-white text-ink border border-line hover:bg-surface disabled:opacity-50',
  danger: 'bg-signal-red text-white hover:brightness-95 disabled:opacity-50',
  ghost: 'text-ink hover:bg-surface disabled:opacity-50',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, className = '', children, disabled, ...rest },
  ref
) {
  const sizeCls = size === 'sm' ? 'text-xs px-2.5 py-1.5' : size === 'lg' ? 'text-sm px-5 py-2.5' : 'text-sm px-3.5 py-2';
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors ${sizeCls} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
});

export const Input = forwardRef(function Input({ className = '', ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-signal-amber/40 focus:border-signal-amber disabled:bg-surface disabled:text-muted ${className}`}
      {...rest}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className = '', ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-signal-amber/40 focus:border-signal-amber ${className}`}
      {...rest}
    />
  );
});

export const Select = forwardRef(function Select({ className = '', children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      // `w-full` only applies when the caller passes no className at all — a
      // caller-supplied `w-*` (e.g. "w-48") is a plain Tailwind width utility
      // too, so appending it after `w-full` wouldn't reliably override it
      // (CSS cascade order between two equal-specificity utility classes
      // depends on generation order, not source order, so `w-full` was
      // silently winning and stretching every custom-width Select to 100%).
      className={`rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-signal-amber/40 focus:border-signal-amber ${className || 'w-full'}`}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-ink mb-1">{label}</span>}
      {children}
      {hint && !error && <span className="block text-xs text-muted mt-1">{hint}</span>}
      {error && <span className="block text-xs text-signal-red mt-1">{error}</span>}
    </label>
  );
}

export function Checkbox({ label, className = '', ...rest }) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm text-ink ${className}`}>
      <input type="checkbox" className="rounded border-line text-ink focus:ring-signal-amber/40" {...rest} />
      {label}
    </label>
  );
}

const BADGE_TONES = {
  neutral: 'bg-surface text-muted border-line',
  green: 'bg-signal-green/10 text-signal-green border-signal-green/20',
  amber: 'bg-signal-amber/10 text-amber-700 border-signal-amber/20',
  red: 'bg-signal-red/10 text-signal-red border-signal-red/20',
  blue: 'bg-signal-blue/10 text-signal-blue border-signal-blue/20',
  purple: 'bg-signal-purple/10 text-signal-purple border-signal-purple/20',
};

export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Spinner({ size = 20, className = '' }) {
  return <Loader2 size={size} className={`animate-spin text-muted ${className}`} />;
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Spinner size={16} /> {label}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center px-6">
      <Icon size={28} className="text-muted mb-1" />
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="text-xs text-muted max-w-sm">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, className = '' }) {
  if (!message) return null;
  return (
    <div className={`flex items-start gap-2 rounded-lg border border-signal-red/30 bg-signal-red/5 px-3 py-2 text-sm text-signal-red ${className}`}>
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  if (!open) return null;
  const widthCls = size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <div
        className={`w-full ${widthCls} rounded-lg bg-card shadow-card border border-line max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink rounded p-1 hover:bg-surface">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-line">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title = 'Are you sure?', message, confirmLabel = 'Confirm', variant = 'danger', onConfirm, onCancel, loading }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} footer={
      <>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>
    }>
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}

export function Table({ columns, children, className = '' }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((col, i) => (
              <th key={col.key ?? (typeof col === 'string' ? col : i)} className="px-4 py-2.5 text-[10px] font-medium text-muted whitespace-nowrap">
                {col.label ?? col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-1 border-b border-line px-8">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === tab.value ? 'border-signal-amber text-ink' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
