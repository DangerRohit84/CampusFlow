// Search the web for details when page content is an SPA
export async function searchDetails(query: string): Promise<string> {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    })
    const html = await resp.text()
    const snippets: string[] = []
    let match

    const snippetRegex = /class="result__snippet"[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    while ((match = snippetRegex.exec(html)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()
      if (text.length > 20) snippets.push(text)
    }

    return snippets.map((s, i) => `[${i + 1}] ${s}`).join('\n')
  } catch {
    return ''
  }
}

// Parse date strings found in search results to YYYY-MM-DD format
export function parseSearchDate(dateStr: string): string {
  if (!dateStr) return ''
  
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  
  // "January 15, 2026" or "Jan 15, 2026"
  const monthNames: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  }
  
  const longMatch = dateStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/)
  if (longMatch) {
    const month = monthNames[longMatch[1].toLowerCase()]
    if (month) {
      return `${longMatch[3]}-${month}-${longMatch[2].padStart(2, '0')}`
    }
  }
  
  // "15 January 2026" or "15 Jan 2026"
  const reverseMatch = dateStr.match(/(\d{1,2})\s+(\w+)\s*(\d{4})?/)
  if (reverseMatch) {
    const month = monthNames[reverseMatch[2].toLowerCase()]
    if (month) {
      const year = reverseMatch[3] || new Date().getFullYear().toString()
      return `${year}-${month}-${reverseMatch[1].padStart(2, '0')}`
    }
  }
  
  // "01/15/2026" or "15/01/2026"
  const slashMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (slashMatch) {
    // Assume MM/DD/YYYY if first part <= 12
    const first = parseInt(slashMatch[1])
    const second = parseInt(slashMatch[2])
    if (first <= 12 && second <= 31) {
      return `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`
    } else if (second <= 12 && first <= 31) {
      return `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`
    }
  }
  
  return ''
}
