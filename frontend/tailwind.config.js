/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1B2333',      // sidebar / deep navy
        inkdeep: '#131A28',
        surface: '#F7F8FA',  // page background
        card: '#FFFFFF',
        line: '#E4E7EC',
        muted: '#6B7280',
        signal: {
          amber: '#F5A623',  // on-call / live accent
          green: '#22C55E',  // coverage / success
          red: '#EF4444',    // escalation / critical
          blue: '#3B82F6',   // informational
          purple: '#A855F7', // Global Admin role badge
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.08)',
      },
    },
  },
  plugins: [],
};
