import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Demo App</h1>
        <p className="text-muted-foreground">
          Next.js + Prisma + shadcn/ui + K3s PostgreSQL
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/users">
          <Card className="hover:border-foreground/20 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <CardDescription>
                Manage users — create, edit, delete
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/posts">
          <Card className="hover:border-foreground/20 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle>Posts</CardTitle>
              <CardDescription>
                Manage blog posts — create, edit, publish
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
