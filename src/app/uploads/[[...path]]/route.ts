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

    // /uploads a secas (o /uploads/): es un directorio, no un archivo — 404
    // limpio, no el 500 que daba readFileSync(EISDIR).
    if (filePathParams.length === 0) {
      return new NextResponse("Not Found", { status: 404 });
    }

    // Case-insensitive: on case-insensitive filesystems the file could exist under another casing.
    if (filePathParams[0]?.toLowerCase() === "payments") {
      if (filePathParams.length !== 2) return new NextResponse("Not Found", { status: 404 })
      return getPrivateProof(req, { params: Promise.resolve({ filename: filePathParams[1] }) })
    }

    // Validar que no haya intentos de path traversal
    if (filePathParams.some(p => p.includes('..') || p.includes('/') || p.includes('\\'))) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Un segmento con NUL rompe path.join/open con excepción: 404 limpio.
    if (filePathParams.some(p => p.includes("\0"))) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const filePath = path.join(process.cwd(), "public", "uploads", ...filePathParams);

    // stat + isFile: inexistente, directorio (p. ej. /uploads/products a
    // secas) o un stat que falla (symlink roto, permisos) → 404 limpio,
    // nunca el 500 que daba readFileSync(EISDIR).
    let stat: fs.Stats | null = null;
    try { stat = fs.statSync(filePath) } catch { /* cae al 404 de abajo */ }
    if (!stat?.isFile()) {
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