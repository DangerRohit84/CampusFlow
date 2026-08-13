import { Router, Response } from 'express'
import Groq from 'groq-sdk'
import { z } from 'zod'
import prisma from '../config/db'
import { authenticate, AuthRequest } from '../middleware/auth'
import { config } from '../config'

const router = Router()
router.use(authenticate)

const messageSchema = z.object({
  content: z.string().min(1),
})

const providerSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
}).optional()

// Chat with any OpenAI-compatible provider
async function chatWithProvider(userMessage: string, provider?: { baseUrl?: string; apiKey?: string; model?: string }, context?: string): Promise<string> {
  const apiKey = provider?.apiKey || config.groqApiKey || ''
  const model = provider?.model || 'llama-3.3-70b-versatile'

  if (!apiKey || apiKey === 'your-groq-api-key-here') {
    return getSmartResponse(userMessage)
  }

  try {
    const clientOptions: any = { apiKey }
    if (provider?.baseUrl) clientOptions.baseURL = provider.baseUrl
    const groq = new Groq(clientOptions)
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are CampusFlow, an AI-powered campus assistant for university students. Be concise, friendly, and actionable.' },
        ...(context ? [{ role: 'system' as const, content: `Student context: ${context}` }] : []),
        { role: 'user', content: userMessage },
      ],
      model,
      temperature: 0.7,
      max_tokens: 1024,
    })
    return completion.choices[0]?.message?.content || 'I could not generate a response.'
  } catch (error: any) {
    console.error('AI provider error:', error?.message || error)
    return getSmartResponse(userMessage)
  }
}

function getSmartResponse(query: string): string {
  const lower = query.toLowerCase()
  if (lower.includes('schedule') || lower.includes('class') || lower.includes('today')) {
    return "I can help with your schedule! Check the Schedule page for your full timetable, or ask me about specific classes."
  }
  if (lower.includes('assignment') || lower.includes('due')) {
    return "Check the Assignments page for all your deadlines. Want help prioritizing them?"
  }
  if (lower.includes('exam') || lower.includes('test')) {
    return "Your next exam schedule is available on the Dashboard. Want me to help you create a study plan?"
  }
  if (lower.includes('attendance')) {
    return "Check the Attendance page for your attendance tracking. Want tips on improving it?"
  }
  if (lower.includes('grade') || lower.includes('gpa')) {
    return "Visit the Grades page to see all your grades. Want help understanding your performance?"
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hey! I'm your CampusFlow AI assistant. I can help with schedules, assignments, exams, grades, and more. What would you like to know?"
  }
  return "I can help you with your schedule, assignments, exams, grades, and attendance. Could you rephrase your question or let me know what you need?"
}

// Get all chat sessions
router.get('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    })
    res.json(sessions)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

// Create chat session
router.post('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.chatSession.create({
      data: {
        userId: req.userId!,
        title: 'New Chat',
      },
    })
    res.status(201).json(session)
  } catch (error) {
    res.status(500).json({ error: 'Failed to create session' })
  }
})

// Get session messages
router.get('/sessions/:sessionId/messages', async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.sessionId as string, userId: req.userId },
    })
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: req.params.sessionId as string },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// Send message and get AI response
router.post('/sessions/:sessionId/messages', async (req: AuthRequest, res: Response) => {
  try {
    const body = messageSchema.parse(req.body)
    const provider = providerSchema.parse(req.body.provider)
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.sessionId as string, userId: req.userId },
    })
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const userMessage = await prisma.chatMessage.create({
      data: { sessionId: req.params.sessionId as string, role: 'USER', content: body.content },
    })

    const recentMessages = await prisma.chatMessage.findMany({
      where: { sessionId: req.params.sessionId as string },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    const context = recentMessages.reverse().map((m) => `${m.role}: ${m.content}`).join('\n')

    const aiResponse = await chatWithProvider(body.content, provider, context)

    const assistantMessage = await prisma.chatMessage.create({
      data: { sessionId: req.params.sessionId as string, role: 'ASSISTANT', content: aiResponse },
    })

    await prisma.chatSession.update({
      where: { id: req.params.sessionId as string },
      data: { updatedAt: new Date(), title: recentMessages.length <= 1 ? body.content.slice(0, 50) : undefined },
    })

    res.json({ userMessage, assistantMessage })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    console.error('Chat error:', error)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// Quick ask (no session needed)
router.post('/ask', async (req: AuthRequest, res: Response) => {
  try {
    const body = messageSchema.parse(req.body)
    const provider = providerSchema.parse(req.body.provider)
    const response = await chatWithProvider(body.content, provider)
    res.json({ response })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors })
      return
    }
    res.status(500).json({ error: 'Failed to get response' })
  }
})

// Summarize content
router.post('/summarize', async (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body
    const provider = providerSchema.parse(req.body?.provider)
    if (!content) {
      res.status(400).json({ error: 'Content is required' })
      return
    }
    const summary = await chatWithProvider(`Summarize this in 3-5 bullet points:\n\n${content}`, provider)
    res.json({ summary })
  } catch (error) {
    res.status(500).json({ error: 'Failed to summarize' })
  }
})

export default router