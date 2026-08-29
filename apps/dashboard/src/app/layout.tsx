import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RivoCloud',
  description: 'CDN, storage, and analytics — one dashboard.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
