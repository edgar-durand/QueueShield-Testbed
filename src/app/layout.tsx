import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QueueShield Testbed',
  description: 'Security testing platform for web queue systems and bot detection',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
