import type { Telegraf } from "telegraf"

export function registerMiid(bot: Telegraf) {
  bot.command("miid", async (ctx) => {
    const telegramId = ctx.from.id.toString()
    await ctx.reply(
      `🆔 *Tu Telegram ID:*

\`${telegramId}\`

_Copia este número para vincular tu cuenta._`,
      { parse_mode: "Markdown" }
    )
  })
}
