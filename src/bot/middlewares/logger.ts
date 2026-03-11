import { Context, type MiddlewareFn } from "telegraf"

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
    console.error("Bot Error:", e)
  }
}
