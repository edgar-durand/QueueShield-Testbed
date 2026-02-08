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
      <head>
        {process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY && (
          <script
            src={`https://www.google.com/recaptcha/api.js?render=${process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}`}
            async
            defer
          />
        )}
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
