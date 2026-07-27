// Rendered at the top of the sidebar (App.jsx's Shell). `branding` is the
// normalized shape from context/BrandingContext.jsx — already defaulted to
// the base Ink/Amber tokens when no node in the chain has an override.
export default function BrandedHeader({ branding }) {
  const name = branding?.nameOverride || 'Nexus Portal';

  return (
    <div className="px-4 py-5 bg-white border-b border-line">
      {branding?.logoUrl ? (
        <img src={branding.logoUrl} alt={name} className="h-16 w-16 object-contain object-left" />
      ) : (
        <span className="text-lg font-semibold tracking-tight text-ink">{name}</span>
      )}
      {branding?.tagline && <p className="text-sm font-bold text-ink mt-1.5 truncate">{branding.tagline}</p>}
    </div>
  );
}
