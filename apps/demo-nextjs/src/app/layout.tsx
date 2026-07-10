import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Demo App",
  description: "Demo test app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-background">
          <header className="border-b">
            <div className="container mx-auto flex h-14 items-center px-4">
              <Link href="/" className="mr-6 font-semibold">
                PT Bentang Inspirasi Teknologi
              </Link>
              <nav className="flex gap-4">
                <Link
                  href="/users"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Users
                </Link>
                <Link
                  href="/posts"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Posts
                </Link>
              </nav>
            </div>
          </header>
          <main className="container mx-auto p-4">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
