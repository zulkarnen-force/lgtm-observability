import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("demo-nextjs-api");

// GET /api/users
export async function GET() {
  return tracer.startActiveSpan("GET /api/users", async (span) => {
    try {
      span.setAttribute("http.method", "GET");
      span.setAttribute("http.route", "/api/users");

      const users = await tracer.startActiveSpan("prisma.user.findMany", async (dbSpan) => {
        try {
          const result = await prisma.user.findMany({
            include: { posts: true },
            orderBy: { createdAt: "desc" },
          });
          dbSpan.setAttribute("db.users.count", result.length);
          return result;
        } catch (e) {
          dbSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          dbSpan.end();
        }
      });

      span.setAttribute("http.status_code", 200);
      return NextResponse.json(users);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch users" },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}

// POST /api/users
export async function POST(request: Request) {
  return tracer.startActiveSpan("POST /api/users", async (span) => {
    try {
      span.setAttribute("http.method", "POST");
      span.setAttribute("http.route", "/api/users");

      const body = await request.json();
      const { email, name } = body;

      if (!email) {
        span.setAttribute("http.status_code", 400);
        return NextResponse.json(
          { error: "Email is required" },
          { status: 400 }
        );
      }

      const user = await tracer.startActiveSpan("prisma.user.create", async (dbSpan) => {
        try {
          const result = await prisma.user.create({
            data: { email, name },
            include: { posts: true },
          });
          dbSpan.setAttribute("db.user.id", result.id);
          return result;
        } catch (e) {
          dbSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          dbSpan.end();
        }
      });

      span.setAttribute("http.status_code", 201);
      span.setAttribute("user.id", user.id);
      return NextResponse.json(user, { status: 201 });
    } catch (error: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      if (error?.code === "P2002") {
        return NextResponse.json(
          { error: "Email already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to create user" },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}
