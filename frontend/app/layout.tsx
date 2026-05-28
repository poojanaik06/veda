import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Assignment Generator",
  description: "AI-powered assignment builder",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-black min-h-screen">
        {children}
      </body>
    </html>
  );
}