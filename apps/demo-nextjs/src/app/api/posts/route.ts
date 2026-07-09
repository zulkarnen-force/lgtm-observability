import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("demo-nextjs-api");

// GET /api/posts
export async function GET() {
  return tracer.startActiveSpan("GET /api/posts", async (span) => {
    try {
      span.setAttribute("http.method", "GET");
      span.setAttribute("http.route", "/api/posts");

      const posts = await tracer.startActiveSpan("prisma.post.findMany", async (dbSpan) => {
        try {
          const result = await prisma.post.findMany({
            include: { author: true },
            orderBy: { createdAt: "desc" },
          });
          dbSpan.setAttribute("db.posts.count", result.length);
          return result;
        } catch (e) {
          dbSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          dbSpan.end();
        }
      });

      span.setAttribute("http.status_code", 200);
      return NextResponse.json(posts);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch posts" },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}

// POST /api/posts
export async function POST(request: Request) {
  return tracer.startActiveSpan("POST /api/posts", async (span) => {
    try {
      span.setAttribute("http.method", "POST");
      span.setAttribute("http.route", "/api/posts");

      const body = await request.json();
      const { title, content, published, authorId } = body;

      if (!title || !authorId) {
        span.setAttribute("http.status_code", 400);
        return NextResponse.json(
          { error: "Title and author are required" },
          { status: 400 }
        );
      }

      const post = await tracer.startActiveSpan("prisma.post.create", async (dbSpan) => {
        try {
          const result = await prisma.post.create({
            data: {
              title,
              content,
              published: published ?? false,
              authorId: Number(authorId),
            },
            include: { author: true },
          });
          dbSpan.setAttribute("db.post.id", result.id);
          return result;
        } catch (e) {
          dbSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          dbSpan.end();
        }
      });

      span.setAttribute("http.status_code", 201);
      span.setAttribute("post.id", post.id);
      return NextResponse.json(post, { status: 201 });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      return NextResponse.json(
        { error: "Failed to create post" },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}
