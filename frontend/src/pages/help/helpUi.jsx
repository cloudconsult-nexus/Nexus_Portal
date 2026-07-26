import { Info, AlertTriangle, Lightbulb } from 'lucide-react';

// Small presentational atoms shared by every help/help/* content page via
// BlockRenderer.jsx — kept separate from components/ui.jsx since these are
// specific to long-form documentation layout, not the app chrome.

export function HelpHeading({ level = 2, children }) {
  if (level === 1) return <h1 className="text-xl font-semibold text-ink mt-8 mb-3 first:mt-0">{children}</h1>;
  if (level === 3) return <h3 className="text-sm font-semibold text-ink mt-5 mb-2">{children}</h3>;
  return <h2 className="text-base font-semibold text-ink mt-7 mb-2.5 first:mt-0">{children}</h2>;
}

export function HelpParagraph({ children }) {
  return <p className="text-sm text-ink/90 leading-relaxed mb-3">{children}</p>;
}

export function HelpList({ items, ordered }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`text-sm text-ink/90 leading-relaxed mb-3 pl-5 space-y-1 ${ordered ? 'list-decimal' : 'list-disc'}`}>
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </Tag>
  );
}

const CALLOUT_STYLES = {
  info: { icon: Info, cls: 'border-signal-blue/30 bg-signal-blue/5 text-signal-blue' },
  warning: { icon: AlertTriangle, cls: 'border-signal-amber/30 bg-signal-amber/5 text-amber-800' },
  tip: { icon: Lightbulb, cls: 'border-signal-green/30 bg-signal-green/5 text-signal-green' },
};

export function HelpCallout({ tone = 'info', children }) {
  const { icon: Icon, cls } = CALLOUT_STYLES[tone] || CALLOUT_STYLES.info;
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2.5 text-sm mb-4 ${cls}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

export function HelpCode({ children }) {
  return <pre className="rounded-lg bg-ink text-white text-xs font-mono p-3 overflow-x-auto mb-4"><code>{children}</code></pre>;
}

export function HelpTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border border-line rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-surface text-left">
            {headers.map((h) => <th key={h} className="px-3 py-2 font-medium text-muted border-b border-line">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => <td key={j} className="px-3 py-2 text-ink font-mono text-xs">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HelpSectionNavGroup({ title, children }) {
  return (
    <div className="mb-4">
      <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
