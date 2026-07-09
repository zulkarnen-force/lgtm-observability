import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("demo-nextjs-api");

// GET /api/users/:id
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return tracer.startActiveSpan("GET /api/users/:id", async (span) => {
    try {
      const { id } = await params;
      span.setAttribute("http.method", "GET");
      span.setAttribute("http.route", "/api/users/:id");
      span.setAttribute("user.id", Number(id));

      const user = await tracer.startActiveSpan("prisma.user.findUnique", async (dbSpan) => {
        try {
          const result = await prisma.user.findUnique({
            where: { id: Number(id) },
            include: { posts: true },
          });
          dbSpan.setAttribute("db.found", result !== null);
          return result;
        } catch (e) {
          dbSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          dbSpan.end();
        }
      });

      if (!user) {
        span.setAttribute("http.status_code", 404);
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      span.setAttribute("http.status_code", 200);
      return NextResponse.json(user);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch user" },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}

// PUT /api/users/:id
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return tracer.startActiveSpan("PUT /api/users/:id", async (span) => {
    try {
      const { id } = await params;
      span.setAttribute("http.method", "PUT");
      span.setAttribute("http.route", "/api/users/:id");
      span.setAttribute("user.id", Number(id));

      const body = await request.json();
      const { email, name } = body;

      const user = await tracer.startActiveSpan("prisma.user.update", async (dbSpan) => {
        try {
          const result = await prisma.user.update({
            where: { id: Number(id) },
            data: {
              ...(email !== undefined && { email }),
              ...(name !== undefined && { name }),
            },
            include: { posts: true },
          });
          return result;
        } catch (e) {
          dbSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          dbSpan.end();
        }
      });

      span.setAttribute("http.status_code", 200);
      return NextResponse.json(user);
    } catch (error: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      if (error?.code === "P2025") {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      if (error?.code === "P2002") {
        return NextResponse.json(
          { error: "Email already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to update user" },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}

// DELETE /api/users/:id
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return tracer.startActiveSpan("DELETE /api/users/:id", async (span) => {
    try {
      const { id } = await params;
      span.setAttribute("http.method", "DELETE");
      span.setAttribute("http.route", "/api/users/:id");
      span.setAttribute("user.id", Number(id));

      await tracer.startActiveSpan("prisma.user.delete", async (dbSpan) => {
        try {
          await prisma.user.delete({ where: { id: Number(id) } });
        } catch (e) {
          dbSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
          throw e;
        } finally {
          dbSpan.end();
        }
      });

      span.setAttribute("http.status_code", 200);
      return NextResponse.json({ message: "User deleted" });
    } catch (error: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      if (error?.code === "P2025") {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Failed to delete user" },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}
