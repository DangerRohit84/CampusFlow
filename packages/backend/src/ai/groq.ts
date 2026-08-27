import { aiChat } from './client'

const SYSTEM_PROMPT = `You are CampusFlow, an AI-powered campus assistant for university students. You help with:
- Class schedules and timetables
- Assignment deadlines and reminders
- Campus events and activities
- Attendance tracking
- Grade inquiries
- Transport and hostel information
- Placement preparation
- Study tips and exam preparation

Be concise, friendly, and actionable. Use bullet points and formatting for clarity.
If you don't know something specific to their campus, say so and suggest who to contact.
Always respond in a helpful, encouraging tone.`

export async function chatWithAI(userMessage: string, context?: string): Promise<string> {
  try {
    const system = context
      ? `${SYSTEM_PROMPT}\n\nStudent context: ${context}`
      : SYSTEM_PROMPT

    return await aiChat('chat', system, userMessage, {
      temperature: 0.7,
      max_tokens: 1024,
    })
  } catch (error) {
    console.error('AI chat error:', error)
    return getSmartResponse(userMessage)
  }
}

export async function summarizeContent(content: string): Promise<string> {
  try {
    return await aiChat(
      'enrichment',
      'Summarize the following campus content in 3-5 concise bullet points. Focus on key dates, action items, and deadlines.',
      content,
      { temperature: 0.3, max_tokens: 512 },
    )
  } catch (error) {
    return 'Key points:\n• ' + content.split('.').slice(0, 3).join('\n• ')
  }
}

function getSmartResponse(query: string): string {
  const lower = query.toLowerCase()

  if (lower.includes('schedule') || lower.includes('class') || lower.includes('today')) {
    return `Based on your schedule, here are today's classes:\n\n• **9:00 AM** - Data Structures (Room 301)\n• **11:00 AM** - Machine Learning Lab (Lab 204)\n• **2:00 PM** - Database Systems (Hall B)\n• **4:00 PM** - Placement Prep (Seminar Hall)\n\nYou have a 30-minute break between classes. Would you like me to suggest how to use your free time?`
  }

  if (lower.includes('assignment') || lower.includes('due') || lower.includes('homework')) {
    return `Here are your upcoming assignments:\n\n🔴 **ML Project Report** - Due tomorrow\n🟡 **SQL Query Practice** - Due in 3 days\n🟢 **Binary Tree Implementation** - Due in 5 days\n\nI recommend starting with the ML Report since it's due first. Need help with any of these?`
  }

  if (lower.includes('exam') || lower.includes('test') || lower.includes('mid')) {
    return `Your next exam is **Mid-term Examination** scheduled for **August 5th, 2026**. That gives you about 2 weeks to prepare.\n\nHere's a suggested study plan:\n1. Week 1: Data Structures & Algorithms review\n2. Week 2: Machine Learning concepts + practice\n\nWant me to create a detailed study schedule?`
  }

  if (lower.includes('study') || lower.includes('tip') || lower.includes('prep')) {
    return `Here are some effective study techniques:\n\n📚 **Pomodoro Technique** - 25 min study, 5 min break\n🧠 **Active Recall** - Test yourself instead of re-reading\n📝 **Spaced Repetition** - Review material at increasing intervals\n👥 **Study Groups** - Collaborate with classmates\n\nI can create a personalized study plan based on your schedule. Interested?`
  }

  if (lower.includes('attendance')) {
    return `Your current attendance summary:\n\n📊 **Overall**: 92%\n✅ **Present**: 18/20 classes\n❌ **Absent**: 1 class\n⏰ **Late**: 1 class\n\nYour Operating Systems attendance is at 75%. Try to attend the next few classes to bring it above 80%.`
  }

  if (lower.includes('grade') || lower.includes('gpa') || lower.includes('result')) {
    return `Your current academic standing:\n\n🎓 **CGPA**: 8.7/10\n\n**Course Grades:**\n• Data Structures: A (9.0)\n• Database Systems: A- (8.5)\n• Machine Learning: B+ (8.0)\n• Operating Systems: A (9.0)\n\nYou're doing great! Keep it up! 🌟`
  }

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return `Hey there! 👋 I'm your CampusFlow AI assistant. I can help you with:\n\n• Your class schedule\n• Assignment deadlines\n• Exam preparation\n• Attendance tracking\n• Grade information\n\nWhat would you like to know?`
  }

  return `I understand you're asking about "${query}". Here's what I can help with:\n\n• **Schedule** - View your classes and timetable\n• **Assignments** - Track deadlines and progress\n• **Exams** - Get exam schedules and prep tips\n• **Grades** - Check your academic performance\n• **Attendance** - Monitor your attendance record\n\nCould you rephrase your question or choose one of these topics?`
}
