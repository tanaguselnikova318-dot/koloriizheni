import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env'), override: true })

const app = express()
app.use(express.json({ limit: '25mb' }))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

app.post('/api/analyze', async (req, res) => {
  const { base64, mimeType, voiceHint, textOnly } = req.body
  if (!base64 && !textOnly) return res.status(400).json({ error: 'Изображение не загружено' })

  try {
    const jsonSchema = `{
  "foodName": "название блюда по-русски",
  "description": "краткое описание по-русски (1 предложение)",
  "calories": <целое число ккал>,
  "protein": <белки в граммах, целое число>,
  "carbs": <углеводы в граммах, целое число>,
  "fat": <жиры в граммах, целое число>,
  "confidence": "high" | "medium" | "low",
  "items": [{"name": "компонент по-русски", "calories": <число>}]
}`

    let prompt
    if (textOnly) {
      prompt = `Ты — диетолог-нутрициолог. Пользователь описал еду: "${voiceHint}".
Верни ТОЛЬКО валидный JSON, без пояснений и markdown:
${jsonSchema}
Если еда не понятна, верни: {"error": "Еда не обнаружена"}.`
    } else {
      const hint = voiceHint
        ? ` Пользователь уточняет: "${voiceHint}". Учти это при расчёте порции и калорий.`
        : ''
      prompt = `Ты — диетолог-нутрициолог. Проанализируй это фото еды.${hint}
Верни ТОЛЬКО валидный JSON, без пояснений и markdown:
${jsonSchema}
Оцени для ${voiceHint ? 'указанной пользователем порции' : 'типичной порции на фото'}. Если еда не видна, верни: {"error": "Еда не обнаружена"}.`
    }

    const content = textOnly
      ? [{ type: 'text', text: prompt }]
      : [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 }
          },
          { type: 'text', text: prompt }
        ]

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content }]
    })

    const text = response.content[0].text.trim()
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON in response')
    res.json(JSON.parse(match[0]))
  } catch (err) {
    console.error('Analysis error:', err.message)
    res.status(500).json({ error: 'Не удалось проанализировать' })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`\n🚀 KalorAI API: http://localhost:${PORT}\n`))
