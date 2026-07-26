// Rendered at the top of the sidebar (App.jsx's Shell). `branding` is the
// normalized shape from context/BrandingContext.jsx — already defaulted to
// the base Ink/Amber tokens when no node in the chain has an override.
export default function BrandedHeader({ branding }) {
  const name = branding?.nameOverride || 'Nexus Portal';

  return (
    <div className="px-4 py-5 border-b border-white/10">
      {branding?.logoUrl ? (
        <img src={branding.logoUrl} alt={name} className="h-10 w-10 object-contain object-left" />
      ) : (
        <span className="text-lg font-semibold tracking-tight text-white">{name}</span>
      )}
      {branding?.tagline && <p className="text-xs text-white/50 mt-1 truncate">{branding.tagline}</p>}
    </div>
  );
}
