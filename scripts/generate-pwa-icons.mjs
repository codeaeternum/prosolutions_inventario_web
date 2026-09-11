#!/usr/bin/env node
/**
 * Genera iconos PWA en public/icons/ a partir de public/logo.jpg.
 * Uso: node scripts/generate-pwa-icons.mjs
 * Requiere: npm install --save-dev sharp
 */
import sharp from "sharp"
import { mkdir } from "fs/promises"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const source = join(root, "public", "logo.jpg")
const outDir = join(root, "public", "icons")

const sizes = [72, 96, 128, 144, 152, 192, 384, 512]

async function main() {
  try {
    await mkdir(outDir, { recursive: true })
    const buffer = await sharp(source)
      .resize(512, 512, { fit: "cover" })
      .png()
      .toBuffer()

    for (const size of sizes) {
      const outPath = join(outDir, `icon-${size}x${size}.png`)
      await sharp(buffer).resize(size, size).png().toFile(outPath)
      console.log("Created", outPath)
    }
    console.log("Done. Iconos PWA en public/icons/")
  } catch (err) {
    console.error("Error:", err.message)
    if (err.code === "ENOENT" && err.path?.includes("logo.jpg")) {
      console.error("Coloca public/logo.jpg o indica otra imagen de origen.")
    }
    process.exit(1)
  }
}

main()
