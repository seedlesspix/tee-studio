import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tee Studio",
  description: "Custom T-Shirt Designer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Amatic+SC:wght@400;700&family=Bebas+Neue&family=Bevan&family=Caesar+Dressing&family=Calistoga&family=Concert+One&family=Courgette&family=Creepster&family=Damion&family=Fascinate&family=Handlee&family=Jersey+10&family=Lobster&family=Luckiest+Guy&family=Montserrat:wght@400;700;900&family=New+Rocker&family=Pacifico&family=Playball&family=Rum+Raisin&family=Titan+One&family=Yanone+Kaffeesatz:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
