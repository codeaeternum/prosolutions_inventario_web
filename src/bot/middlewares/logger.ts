import { Context, type MiddlewareFn } from "telegraf"
import { errorText } from "../lib/format"

const isDev = process.env.NODE_ENV !== "production"

export const loggerMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  try {
    if (isDev) {
      if (ctx.message && "text" in ctx.message) {
        console.log(`[Bot] Text: "${ctx.message.text}" from ${ctx.from?.id}`)
      } else if (ctx.callbackQuery) {
        const data = (ctx.callbackQuery as { data?: string }).data
        console.log(`[Bot] Callback: "${data}" from ${ctx.from?.id}`)
      }
    }
    await next()
  } catch (e) {
    // Solo el mensaje: el error crudo (TelegrafError.on) lleva el payload de
    // la request, incluido el texto que mandó el cliente — PII en logs.
    console.error("Bot Error:", errorText(e))
  }
}
