import './globals.css';

export const metadata = {
  title: 'DocIQ — Document Intelligence',
  description: 'Ask questions across your documents and get source-cited answers.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-6xl px-4 py-6">
          <header className="mb-6 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">
              Q
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">DocIQ</h1>
              <p className="text-xs text-slate-500">
                Turn documents into a queryable, source-cited knowledge base.
              </p>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
