import type { Telegraf } from "telegraf"

export function registerMiid(bot: Telegraf) {
  bot.command("miid", (ctx) => {
    const telegramId = ctx.from.id.toString()
    ctx.reply(
      `🆔 *Tu Telegram ID:*

\`${telegramId}\`

_Copia este número para vincular tu cuenta._`,
      { parse_mode: "Markdown" }
    )
  })
}
