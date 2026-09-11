import { GET as getPrivateProof } from "@/app/api/payment-proofs/[filename]/route"
import { NextRequest, NextResponse } from "next/server"
import * as path from "path"
import * as fs from "fs"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const filePathParams = resolvedParams.path || [];
    
    if (filePathParams[0] === "payments") {
      if (filePathParams.length !== 2) return new NextResponse("Not Found", { status: 404 })
      return getPrivateProof(req, { params: Promise.resolve({ filename: filePathParams[1] }) })
    }

    // Validar que no haya intentos de path traversal
    if (filePathParams.some(p => p.includes('..') || p.includes('/') || p.includes('\\'))) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const filePath = path.join(process.cwd(), "public", "uploads", ...filePathParams);

    if (!fs.existsSync(filePath)) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    const ext = path.extname(filePath).toLowerCase();
    let mime = "application/octet-stream";
    if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
    else if (ext === ".png") mime = "image/png";
    else if (ext === ".gif") mime = "image/gif";
    else if (ext === ".webp") mime = "image/webp";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[uploads] Error serving file:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}