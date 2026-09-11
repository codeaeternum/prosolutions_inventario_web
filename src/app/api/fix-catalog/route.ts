import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/api-auth'

/**
 * One-time migration API to fix product names in the catalog.
 * 
 * Fixes:
 * - "IPhone" → "iPhone" (proper capitalization)
 * - Gender consistency for colors with "Pantalla" (Blanco→Blanca, Negros→Negra)
 * - Trailing spaces
 * - Category assignments (iPhone 8, XR → Pantalla LCD)
 * 
 * GET /api/fix-catalog — dry run (preview changes)
 * POST /api/fix-catalog — apply changes
 */

// LCD-only models: these never have OLED screens
// iPhone 11 (base, no Pro) is LCD, but 11 Pro/Pro Max is OLED
const LCD_MODELS_REGEX = /iPhone\s+(5|5s|5c|SE|6|6s|6\s*Plus|7|7\s*Plus|8|8\s*Plus|XR|SE\s*[23]?)\b/i
function isLCDModel(name: string): boolean {
    // iPhone 11 base (without Pro) is LCD
    if (/iPhone\s+11\b/i.test(name) && !/iPhone\s+11\s*Pro/i.test(name)) return true
    return LCD_MODELS_REGEX.test(name)
}

interface NameFix {
    id: string
    oldName: string
    newName: string
    categoryChange?: { from: string; to: string; newCategoryId?: string }
}

function fixProductName(name: string): string {
    let fixed = name.trim()

    // Fix IPhone/Iphone → iPhone
    fixed = fixed.replace(/\b[Ii]Phone\b/g, 'iPhone')

    // Fix color gender for "Pantalla" products (pantalla is feminine)
    if (fixed.startsWith('Pantalla')) {
        // Blanco → Blanca (at end of name)
        fixed = fixed.replace(/\bBlanco\s*$/i, 'Blanca')
        // Negros → Negra (at end of name)
        fixed = fixed.replace(/\bNegros?\s*$/i, 'Negra')
        // Negro → Negra
        fixed = fixed.replace(/\bNegro\s*$/i, 'Negra')
    }

    return fixed
}

export async function GET() {
    try {
        const authResult = await requireAdmin()
        if (authResult.error) return authResult.error
        const products = await prisma.product.findMany({
            include: { category: true }
        })

        const lcdCategory = await prisma.category.findFirst({ where: { name: { contains: 'LCD', mode: 'insensitive' } } })
        const oledCategory = await prisma.category.findFirst({ where: { name: { contains: 'OLED', mode: 'insensitive' } } })

        const fixes: NameFix[] = []

        for (const p of products) {
            const newName = fixProductName(p.name)
            let categoryChange: NameFix['categoryChange'] = undefined

            // Check if this is a Pantalla product that should be LCD not OLED
            if (newName.startsWith('Pantalla') && p.category) {
                const shouldBeLCD = isLCDModel(newName) && !newName.toLowerCase().includes('oled')
                const isOLED = p.category.name.toLowerCase().includes('oled')
                const isLCD = p.category.name.toLowerCase().includes('lcd')

                if (shouldBeLCD && isOLED && lcdCategory) {
                    categoryChange = { from: p.category.name, to: lcdCategory.name, newCategoryId: lcdCategory.id }
                }
                // OLED models are: X, XS, XS Max, 11 Pro+, 12+, 13+, 14+, 15+, 16+
                const shouldBeOLED = /iPhone\s+(X(?!\w)|XS|XS\s*Max|1[1-6]\s*Pro|12|13|14|15|16)/i.test(newName) && !shouldBeLCD
                if (shouldBeOLED && isLCD && oledCategory) {
                    categoryChange = { from: p.category.name, to: oledCategory.name, newCategoryId: oledCategory.id }
                }
            }

            if (newName !== p.name || categoryChange) {
                fixes.push({
                    id: p.id,
                    oldName: p.name,
                    newName,
                    categoryChange
                })
            }
        }

        return NextResponse.json({
            mode: 'DRY_RUN',
            totalProducts: products.length,
            fixesNeeded: fixes.length,
            fixes
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

export async function POST() {
    try {
        const authResult = await requireAdmin()
        if (authResult.error) return authResult.error
        const products = await prisma.product.findMany({
            include: { category: true }
        })

        const lcdCategory = await prisma.category.findFirst({ where: { name: { contains: 'LCD', mode: 'insensitive' } } })
        const oledCategory = await prisma.category.findFirst({ where: { name: { contains: 'OLED', mode: 'insensitive' } } })

        const fixes: NameFix[] = []
        let updated = 0

        for (const p of products) {
            const newName = fixProductName(p.name)
            let categoryChange: NameFix['categoryChange'] = undefined
            let newCategoryId: string | undefined

            if (newName.startsWith('Pantalla') && p.category) {
                const shouldBeLCD = isLCDModel(newName) && !newName.toLowerCase().includes('oled')
                const isOLED = p.category.name.toLowerCase().includes('oled')
                const isLCD = p.category.name.toLowerCase().includes('lcd')

                if (shouldBeLCD && isOLED && lcdCategory) {
                    categoryChange = { from: p.category.name, to: lcdCategory.name }
                    newCategoryId = lcdCategory.id
                }
                const shouldBeOLED = /iPhone\s+(X(?!\w)|XS|XS\s*Max|1[1-6]\s*Pro|12|13|14|15|16)/i.test(newName) && !shouldBeLCD
                if (shouldBeOLED && isLCD && oledCategory) {
                    categoryChange = { from: p.category.name, to: oledCategory.name }
                    newCategoryId = oledCategory.id
                }
            }

            if (newName !== p.name || newCategoryId) {
                const updateData: any = {}
                if (newName !== p.name) updateData.name = newName
                if (newCategoryId) updateData.categoryId = newCategoryId

                await prisma.product.update({
                    where: { id: p.id },
                    data: updateData
                })
                updated++
                fixes.push({ id: p.id, oldName: p.name, newName, categoryChange })
            }
        }

        return NextResponse.json({
            mode: 'APPLIED',
            totalProducts: products.length,
            updated,
            fixes
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
