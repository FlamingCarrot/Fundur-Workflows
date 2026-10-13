import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL("/welcome", request.url);
  const response = NextResponse.redirect(url);
  // Clear any existing app session cookies
  response.cookies.delete("appSession");
  response.cookies.delete("fundur-workspace");
  return response;
}
