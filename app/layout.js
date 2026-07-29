export const metadata = {
  title: "Decor Production Feed",
  description: "Live factory production schedule — Decor Systems",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Production", statusBarStyle: "default" },
};

export const viewport = {
  themeColor: "#004CFB",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
