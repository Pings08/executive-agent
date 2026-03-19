import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/store/AppContext";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Executive Agent | CEO's AI Assistant",
  description: "AI-powered executive assistant for managing objectives, tracking progress, and generating insights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <AppProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 p-8 overflow-auto">
              {children}
            </main>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}