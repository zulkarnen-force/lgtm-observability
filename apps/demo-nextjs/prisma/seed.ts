import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clear existing data
  await prisma.post.deleteMany();
  await prisma.user.deleteMany();

  // Seed users
  const alice = await prisma.user.create({
    data: {
      email: "alice@example.com",
      name: "Alice Johnson",
    },
  });

  const bob = await prisma.user.create({
    data: {
      email: "bob@example.com",
      name: "Bob Smith",
    },
  });

  const charlie = await prisma.user.create({
    data: {
      email: "charlie@example.com",
      name: "Charlie Brown",
    },
  });

  // Seed posts
  await prisma.post.createMany({
    data: [
      {
        title: "Getting Started with Next.js",
        content: "Next.js is a powerful React framework for building modern web applications.",
        published: true,
        authorId: alice.id,
      },
      {
        title: "Understanding Prisma ORM",
        content: "Prisma makes database access easy with type-safe queries.",
        published: true,
        authorId: alice.id,
      },
      {
        title: "Deploying to Kubernetes",
        content: "Kubernetes orchestration simplified for modern apps.",
        published: false,
        authorId: bob.id,
      },
      {
        title: "Observability Best Practices",
        content: "Logging, tracing, and metrics for production systems.",
        published: true,
        authorId: charlie.id,
      },
    ],
  });

  console.log("✅ Seeded 3 users and 4 posts");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
