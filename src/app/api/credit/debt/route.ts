import { NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { changeCredit } from "@/lib/domain/credit"
import { businessFailure } from "@/lib/domain/http"

export async function POST(req: Request) {
  try {
    const auth = await requireModule("credito")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    return NextResponse.json(await changeCredit(prisma, session.user.id, businessIdOf(session), "DEBT", await req.json()))
  } catch (error) { return businessFailure(error) }
}
