import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Sparkles, Bot, User, Calendar, Clock, FileText, Lightbulb, Zap, GraduationCap } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { chatAPI } from '../lib/api'
import { sanitizeMarkdown } from '../lib/sanitize'


function getActiveProvider() {
  try {
    const configs = JSON.parse(localStorage.getItem('campusflow-ai-configs') || '[]')
    const active = localStorage.getItem('campusflow-active-ai') || ''
    const found = configs.find((c: any) => c.provider === active && c.enabled)
    return found ? { baseUrl: found.baseUrl, apiKey: found.apiKey, model: found.model } : undefined
  } catch { return undefined }
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  suggestions?: string[]
}

const quickActions = [
  { icon: Calendar, label: 'My Schedule', query: 'What are my classes today?' },
  { icon: FileText, label: 'Assignments', query: 'What assignments are due this week?' },
  { icon: Clock, label: 'Reminders', query: 'Set a reminder for my exam' },
  { icon: Lightbulb, label: 'Study Tips', query: 'Give me study tips for data structures' },
]

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: "Hi! I'm your AI campus assistant. I can help you with schedules, assignments, exam prep, and more. What would you like to know?", timestamp: new Date(), suggestions: ['What classes do I have today?', 'When is my next exam?', 'Give me study tips'] },
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const activeProviderName = (() => {
    try {
      const configs = JSON.parse(localStorage.getItem('campusflow-ai-configs') || '[]')
      const active = localStorage.getItem('campusflow-active-ai') || ''
      const found = configs.find((c: any) => c.provider === active && c.enabled)
      if (!found) return null
      const providerMap: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Gemini', groq: 'Groq', mistral: 'Mistral', deepseek: 'DeepSeek', xai: 'Grok', openrouter: 'OpenRouter', together: 'Together', fireworks: 'Fireworks', cerebras: 'Cerebras', huggingface: 'HuggingFace', cloudflare: 'Cloudflare', cohere: 'Cohere', novita: 'Novita', ollama: 'Ollama', lmstudio: 'LM Studio' }
      return providerMap[found.provider] || found.provider
    } catch { return null }
  })()

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  useEffect(() => { scrollToBottom() }, [messages])

  useEffect(() => {
    chatAPI.createSession().then((s) => setSessionId(s.id)).catch(console.error)
  }, [])

  const handleSend = async (text?: string) => {
    const query = text || input.trim()
    if (!query) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: query, timestamp: new Date() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    try {
      const provider = getActiveProvider()
      if (sessionId) {
        const res = await chatAPI.sendMessage(sessionId, query, provider)
        const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: res.assistantMessage.content, timestamp: new Date() }
        setMessages((prev) => [...prev, assistantMsg])
      } else {
        const res = await chatAPI.ask(query, provider)
        const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: res.response, timestamp: new Date() }
        setMessages((prev) => [...prev, assistantMsg])
      }
    } catch {
      const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: "Sorry, I couldn't process that. Please try again.", timestamp: new Date() }
      setMessages((prev) => [...prev, assistantMsg])
    }
    setIsTyping(false)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center shadow-e1"><Bot className="w-6 h-6 text-white" /></div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">AI Assistant</h1>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <span className="text-sm text-surface-500 dark:text-night-400">Always online</span>
              <Badge variant="accent" className="ml-1"><Sparkles size={10} /> {activeProviderName || 'Default AI'}</Badge>
            </div>
          </div>
        </div>
      </div>

      <Card padding="none" className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-[1280px] mx-auto">
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center shrink-0 shadow-md"><GraduationCap size={18} className="text-white" /></div>
                )}
                <div className={`max-w-[75%] rounded-2xl px-5 py-3.5 ${msg.role === 'user' ? 'bg-gradient-to-br from-primary-600 to-primary-600 text-white rounded-br-md' : 'bg-surface-100 dark:bg-night-700 text-surface-900 dark:text-night-50 rounded-bl-md'}`}>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(msg.content) }} />
                  {msg.suggestions && (
                    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/10">
                      {msg.suggestions.map((s) => (
                        <button key={s} onClick={() => handleSend(s)} className="px-3 py-1.5 bg-white/10 backdrop-blur-sm rounded-lg text-xs font-medium hover:bg-white/20 transition-colors border border-white/10">{s}</button>
                      ))}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && <div className="w-9 h-9 rounded-xl bg-surface-800 flex items-center justify-center shrink-0"><User size={18} className="text-white" /></div>}
              </motion.div>
            ))}
          </AnimatePresence>
          {isTyping && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center shrink-0"><GraduationCap size={18} className="text-white" /></div>
              <div className="bg-surface-100 dark:bg-night-700 rounded-2xl rounded-bl-md px-5 py-4">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-surface-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {messages.length <= 2 && (
          <div className="px-6 pb-3">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {quickActions.map((action) => (
                <button key={action.label} onClick={() => handleSend(action.query)} className="flex items-center gap-2 px-4 py-2.5 bg-surface-50 dark:bg-night-800 hover:bg-surface-100 dark:hover:bg-night-700 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-medium text-surface-700 dark:text-night-200 transition-all hover:border-primary-200 shrink-0">
                  <action.icon size={16} className="text-primary-500" />{action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 border-t border-surface-100 dark:border-night-600 bg-white/50 dark:bg-night-800/50 backdrop-blur-sm">
          <form onSubmit={(e) => { e.preventDefault(); handleSend() }} className="flex items-center gap-3">
            <div className="flex-1 relative">
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask me anything about campus life..." className="w-full px-5 py-3.5 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all pr-12" disabled={isTyping} />
              <Zap size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" />
            </div>
            <button type="submit" disabled={!input.trim() || isTyping} className="p-3.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-all shadow-lg hover:shadow-xl hover:shadow-primary-500/25 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
              <Send size={18} />
            </button>
          </form>
        </div>
      </Card>
    </motion.div>
  )
}
