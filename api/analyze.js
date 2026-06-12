const Anthropic = require('@anthropic-ai/sdk')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { base64, mimeType } = req.body

  if (!base64) {
    return res.status(400).json({ error: 'Изображение не загружено' })
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 }
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

    res.json(JSON.parse(match[0]))
  } catch (err) {
    console.error('Analysis error:', err.message)
    res.status(500).json({ error: 'Не удалось проанализировать изображение' })
  }
}
