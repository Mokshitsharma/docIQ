import { Instrument_Sans, Source_Serif_4 } from 'next/font/google';
import './globals.css';

const ui = Instrument_Sans({ subsets: ['latin'], variable: '--font-ui' });
const read = Source_Serif_4({ subsets: ['latin'], variable: '--font-read' });

export const metadata = {
  title: 'docIQ: ask your contracts, see the page',
  description: 'Upload a contract or PDF, ask a question, and every answer points to the page it came from.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${ui.variable} ${read.variable}`}>
      <body>
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <header className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule pb-4">
            <span className="font-serif text-2xl font-semibold tracking-tight">docIQ</span>
            <p className="text-sm text-slate-600">
              Ask your documents a question. Every answer shows the page it came from.
            </p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
