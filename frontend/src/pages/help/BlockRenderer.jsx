import { HelpHeading, HelpParagraph, HelpList, HelpCallout, HelpCode, HelpTable } from './helpUi.jsx';

// Turns a blocks.js content array into JSX — the only place that knows the
// mapping from block `type` to a helpUi component.
export default function BlockRenderer({ blocks }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': return <HelpHeading key={i} level={b.level}>{b.text}</HelpHeading>;
          case 'paragraph': return <HelpParagraph key={i}>{b.text}</HelpParagraph>;
          case 'list': return <HelpList key={i} items={b.items} ordered={b.ordered} />;
          case 'callout': return <HelpCallout key={i} tone={b.tone}>{b.text}</HelpCallout>;
          case 'code': return <HelpCode key={i}>{b.text}</HelpCode>;
          case 'table': return <HelpTable key={i} headers={b.headers} rows={b.rows} />;
          default: return null;
        }
      })}
    </>
  );
}
