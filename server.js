import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import multer from 'multer'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env'), override: true })

const app = express()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images'))
    cb(null, true)
  }
})

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Изображение не загружено' })

  try {
    const base64 = req.file.buffer.toString('base64')
    const mimeType = req.file.mimetype

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 }
          },
          {
            type: 'text',
            text: `Ты — диетолог-нутрициолог. Проанализируй это фото еды.
Верни ТОЛЬКО валидный JSON, без пояснений и markdown:
{
  "foodName": "название блюда по-русски",
  "description": "краткое описание по-русски (1 предложение)",
  "calories": <целое число ккал>,
  "protein": <белки в граммах, целое число>,
  "carbs": <углеводы в граммах, целое число>,
  "fat": <жиры в граммах, целое число>,
  "confidence": "high" | "medium" | "low",
  "items": [{"name": "компонент по-русски", "calories": <число>}]
}
Оцени для типичной порции на фото. Если еда не видна, верни: {"error": "Еда не обнаружена"}.`
          }
        ]
      }]
    })

    const text = response.content[0].text.trim()
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON in response')

    const data = JSON.parse(match[0])
    res.json(data)
  } catch (err) {
    console.error('Analysis error:', err.message)
    res.status(500).json({ error: 'Не удалось проанализировать изображение' })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`\n🚀 KalorAI API: http://localhost:${PORT}\n`))
