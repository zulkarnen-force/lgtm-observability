import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "demo-nextjs",
      version: process.env.npm_package_version ?? "unknown",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
    }
  );
}
