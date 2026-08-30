import { forwardRef } from 'react'
import type { ResumeData, ResumeTemplateId } from '../../types/resume'

type Props = {
  data: ResumeData
  template?: ResumeTemplateId
}

const formatDate = (s: string) => {
  if (!s) return ''
  if (s.toLowerCase() === 'present') return 'Present'
  return s
}

function parseSkillRows(skills: string[]): { label: string; value: string }[] {
  if (!skills || skills.length === 0) return []
  const hasColon = skills.some(s => String(s).includes(':'))
  if (!hasColon) {
    // No categorized format — treat as flat. If many flat skills, single row.
    return [{ label: 'Skills', value: skills.map(s => String(s).trim()).filter(Boolean).join(', ') }]
  }
  const rows: { label: string; value: string }[] = []
  for (const raw of skills) {
    const s = String(raw).trim()
    if (!s) continue
    const idx = s.indexOf(':')
    if (idx > 0) {
      const label = s.slice(0, idx).trim()
      const value = s.slice(idx + 1).trim().replace(/^,?\s*/, '')
      rows.push({ label: label.replace(/:$/, ''), value: value || '' })
    } else {
      // No colon: append to last row or create Other
      if (rows.length > 0) {
        rows[rows.length - 1].value = rows[rows.length - 1].value ? `${rows[rows.length - 1].value}, ${s}` : s
      } else {
        rows.push({ label: 'Other', value: s })
      }
    }
  }
  return rows.filter(r => r.value)
}

function BoldKeyword({ text }: { text: string }) {
  const str = String(text)
  // If bullet contains **bold** markdown -> render
  // Prefer first colon as keyword separator, else em dash, else hyphen with spaces
  const colonIdx = str.indexOf(':')
  if (colonIdx > 1 && colonIdx < 80) {
    const before = str.slice(0, colonIdx + 1)
    const after = str.slice(colonIdx + 1)
    return (
      <>
        <span className="font-bold">{before}</span>
        <span>{after}</span>
      </>
    )
  }
  const mdashIdx = str.indexOf(' — ')
  if (mdashIdx > 1 && mdashIdx < 80) {
    const before = str.slice(0, mdashIdx + 3)
    return (
      <>
        <span className="font-bold">{before}</span>
        <span>{str.slice(mdashIdx + 3)}</span>
      </>
    )
  }
  // Check for " - " short hyphen keyword
  const hyphenIdx = str.indexOf(' - ')
  if (hyphenIdx > 1 && hyphenIdx < 80 && /^[A-Z]/.test(str)) {
    const before = str.slice(0, hyphenIdx + 3)
    return (
      <>
        <span className="font-bold">{before}</span>
        <span>{str.slice(hyphenIdx + 3)}</span>
      </>
    )
  }
  return <>{str}</>
}

/** Classic — Jake's Resume 1-col ATS (Overleaf mimic) */
function ClassicTemplate({ data }: { data: ResumeData }) {
  const p = data.personalInfo
  return (
    <div className="bg-white text-[#111827] p-[36px] leading-relaxed text-[12.5px]" style={{ fontFamily: "'Latin Modern Roman','Computer Modern','Times New Roman',serif" }}>
      {/* Header — centered small caps like Jake */}
      <div className="text-center pb-[10px] mb-[10px] border-b-0">
        <h1 className="text-[22pt] leading-none tracking-tight font-bold uppercase" style={{ fontVariant: 'small-caps', fontFamily: "'Latin Modern Roman',serif", letterSpacing: '0.02em' }}>
          {p.fullName || 'Your Name'}
        </h1>
        {p.headline && <p className="text-[9pt] italic text-[#374151] mt-[4px]" style={{ fontFamily: "'Latin Modern Roman',serif" }}>{p.headline}</p>}
        <div className="flex flex-wrap justify-center gap-x-1.5 mt-[6px] text-[8pt] text-[#374151] leading-tight">
          {p.email && <a href={`mailto:${p.email}`} className="hover:underline text-[#111827]">{p.email}</a>}
          {p.phone && <><span className="text-[#9ca3af]">|</span><span>{p.phone}</span></>}
          {p.location && <><span className="text-[#9ca3af]">|</span><span>{p.location}</span></>}
          {p.links.filter(l=>l.url).map((l,i)=>(
            <span key={i} className="inline-flex items-center gap-1">
              <span className="text-[#9ca3af]">|</span>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[#111827] hover:underline underline-offset-2">{l.label}</a>
            </span>
          ))}
        </div>
      </div>

      <div className="h-[0.7px] bg-[#111827] -mx-[2px] mb-[10px]" />

      {p.summary && (
        <section className="mb-[10px]">
          <h2 className="text-[10pt] font-bold tracking-[0.18em] uppercase border-b border-[#111827] pb-[2px] mb-[5px]" style={{ fontVariant: 'small-caps' }}>Summary</h2>
          <p className="text-[8.5pt] leading-[1.45] text-[#1f2937] whitespace-pre-wrap">{p.summary}</p>
        </section>
      )}

      {data.skills.length > 0 && (
        <section className="mb-[10px]">
          <h2 className="text-[10pt] font-bold tracking-[0.18em] uppercase border-b border-[#111827] pb-[2px] mb-[5px]" style={{ fontVariant: 'small-caps' }}>Skills</h2>
          <p className="text-[8.5pt] leading-[1.45] text-[#1f2937]">{data.skills.join(', ')}</p>
        </section>
      )}

      {data.experience.length > 0 && (
        <section className="mb-[10px]">
          <h2 className="text-[10pt] font-bold tracking-[0.18em] uppercase border-b border-[#111827] pb-[2px] mb-[5px]" style={{ fontVariant: 'small-caps' }}>Experience</h2>
          <div className="space-y-[8px]">
            {data.experience.map(exp=>(
              <div key={exp.id}>
                <div className="flex justify-between gap-2 items-baseline">
                  <h3 className="font-bold text-[9pt] text-[#111827]">{exp.role || 'Role'} <span className="font-normal italic text-[#374151]">— {exp.company || 'Company'}{exp.location ? ` — ${exp.location}` : ''}</span></h3>
                  <span className="text-[7.5pt] text-[#6b7280] shrink-0 tracking-tight">{formatDate(exp.startDate)} – {formatDate(exp.endDate)}</span>
                </div>
                {exp.bullets.filter(Boolean).length>0 && (
                  <ul className="list-disc pl-[14px] mt-[3px] space-y-[1px] marker:text-[#111827]">
                    {exp.bullets.filter(Boolean).map((b,i)=>(<li key={i} className="text-[8.5pt] text-[#1f2937] leading-[1.4]">{b}</li>))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.projects.length > 0 && (
        <section className="mb-[10px]">
          <h2 className="text-[10pt] font-bold tracking-[0.18em] uppercase border-b border-[#111827] pb-[2px] mb-[5px]" style={{ fontVariant: 'small-caps' }}>Projects</h2>
          <div className="space-y-[8px]">
            {data.projects.map(proj=>(
              <div key={proj.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <h3 className="font-bold text-[9pt] text-[#111827]">{proj.title || 'Untitled Project'}</h3>
                  {proj.date && <span className="text-[7.5pt] text-[#6b7280] shrink-0">{proj.date}</span>}
                </div>
                {proj.tech.length>0 && <p className="text-[7.5pt] italic text-[#2D4A9A] mt-[1px]">{proj.tech.join(' · ')}</p>}
                {proj.description && <p className="text-[8pt] text-[#1f2937] mt-[2px] leading-[1.4]">{proj.description}</p>}
                {proj.link && <a href={proj.link} target="_blank" rel="noopener noreferrer" className="text-[7.5pt] text-[#111827] hover:underline break-all">{proj.link}</a>}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.education.length > 0 && (
        <section className="mb-[10px]">
          <h2 className="text-[10pt] font-bold tracking-[0.18em] uppercase border-b border-[#111827] pb-[2px] mb-[5px]" style={{ fontVariant: 'small-caps' }}>Education</h2>
          <div className="space-y-[6px]">
            {data.education.map(ed=>(
              <div key={ed.id} className="flex justify-between gap-2">
                <div>
                  <h3 className="font-bold text-[9pt] text-[#111827]">{ed.degree || 'Degree'}</h3>
                  <p className="text-[8pt] text-[#374151]">{ed.school}{ed.location ? `, ${ed.location}` : ''}</p>
                  {ed.cgpa && <p className="text-[7.5pt] text-[#6b7280]">CGPA: {ed.cgpa}</p>}
                </div>
                <span className="text-[7.5pt] text-[#6b7280] shrink-0">{formatDate(ed.startDate)} – {formatDate(ed.endDate)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.certifications && data.certifications.length > 0 && (
        <section className="mb-[2px]">
          <h2 className="text-[10pt] font-bold tracking-[0.18em] uppercase border-b border-[#111827] pb-[2px] mb-[5px]" style={{ fontVariant: 'small-caps' }}>Certifications</h2>
          <div className="space-y-[6px]">
            {data.certifications.map(c=>(
              <div key={c.id} className="flex justify-between gap-2">
                <div>
                  <h3 className="font-bold text-[9pt] text-[#111827]">{c.name}{c.issuer ? <span className="font-normal italic text-[#374151]"> — {c.issuer}</span> : null}</h3>
                  {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[7.5pt] text-[#111827] hover:underline break-all">{c.url}</a>}
                </div>
                {c.date && <span className="text-[7.5pt] text-[#6b7280] shrink-0">{c.date}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[6px] text-center text-[#9ca3af] mt-[14px] tracking-wide">Overleaf-like vector — selectable, hyperlinked (Jake's Classic)</p>
    </div>
  )
}

/** Modern — AltaCV two-column (Overleaf mimic) */
function ModernTemplate({ data }: { data: ResumeData }) {
  const p = data.personalInfo
  return (
    <div className="bg-white text-[#1f2937] overflow-hidden" style={{ fontFamily: "'Inter','Helvetica Neue',Helvetica,Arial,sans-serif" }}>
      {/* Accent top rule */}
      <div className="h-[2.5px] bg-[#2D4A9A]" />
      {/* Header */}
      <div className="px-[28px] pt-[14px] pb-[12px] text-center border-b border-[#2D4A9A]/20">
        <h1 className="text-[20pt] font-extrabold tracking-tight text-[#2D4A9A] leading-none">{p.fullName || 'Your Name'}</h1>
        {p.headline && <p className="text-[9.5pt] italic text-[#4b5563] mt-[3px]">{p.headline}</p>}
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-[8px] text-[7.5pt] text-[#4b5563]">
          {p.email && <span className="inline-flex items-center gap-1"><span className="text-[#2D4A9A]">✉</span> {p.email}</span>}
          {p.phone && <span className="inline-flex items-center gap-1"><span className="text-[#2D4A9A]">☎</span> {p.phone}</span>}
          {p.location && <span className="inline-flex items-center gap-1"><span className="text-[#2D4A9A]">◉</span> {p.location}</span>}
          {p.links.filter(l=>l.url).map((l,i)=>(
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#2D4A9A] hover:underline">
              <span>{/github/i.test(l.label)? '◈' : /linkedin/i.test(l.label)? '⬡' : '↗'}</span> {l.label}
            </a>
          ))}
        </div>
      </div>

      {p.summary && (
        <div className="px-[28px] pt-[10px]">
          <h2 className="text-[9pt] font-bold tracking-[0.14em] uppercase text-[#2D4A9A] flex items-center gap-2"> <span className="w-[18px] h-[2px] bg-[#2D4A9A]" /> Summary </h2>
          <div className="h-[1px] bg-[#2D4A9A] mt-[3px] mb-[6px]" />
          <p className="text-[8.3pt] leading-[1.5] text-[#1f2937]">{p.summary}</p>
        </div>
      )}

      {/* Two-column body */}
      <div className="grid grid-cols-[1.62fr_0.98fr] gap-[18px] px-[28px] py-[12px]">
        {/* Left column */}
        <div className="space-y-[14px]">
          {data.experience.length>0 && (
            <section>
              <h2 className="text-[8.5pt] font-bold tracking-[0.14em] uppercase text-[#2D4A9A] flex items-center gap-2">
                <span className="w-[18px] h-[2px] bg-[#2D4A9A]" /> Experience
              </h2>
              <div className="h-[1px] bg-[#2D4A9A]/30 mt-[3px] mb-[8px]" />
              <div className="space-y-[10px]">
                {data.experience.map(exp=>(
                  <div key={exp.id}>
                    <div className="flex justify-between gap-2 items-baseline">
                      <h3 className="font-bold text-[8.8pt] text-[#111827] leading-tight">{exp.role || 'Role'}</h3>
                      <span className="text-[7pt] text-[#2D4A9A] font-medium shrink-0">{formatDate(exp.startDate)} – {formatDate(exp.endDate)}</span>
                    </div>
                    <p className="text-[7.8pt] italic text-[#4b5563]">{exp.company}{exp.location ? ` | ${exp.location}` : ''}</p>
                    <ul className="mt-[3px] space-y-[1.5px] pl-[12px] list-disc marker:text-[#2D4A9A]">
                      {exp.bullets.filter(Boolean).map((b,i)=>(<li key={i} className="text-[7.8pt] text-[#1f2937] leading-[1.45]">{b}</li>))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.projects.length>0 && (
            <section>
              <h2 className="text-[8.5pt] font-bold tracking-[0.14em] uppercase text-[#2D4A9A] flex items-center gap-2">
                <span className="w-[18px] h-[2px] bg-[#2D4A9A]" /> Projects
              </h2>
              <div className="h-[1px] bg-[#2D4A9A]/30 mt-[3px] mb-[8px]" />
              <div className="space-y-[10px]">
                {data.projects.map(proj=>(
                  <div key={proj.id} className="bg-[#EEF1FF]/60 rounded-[8px] p-[9px] border border-[#E0E7FF]">
                    <div className="flex justify-between gap-2">
                      <h3 className="font-bold text-[8.8pt] text-[#111827]">{proj.title || 'Untitled'}</h3>
                      {proj.date && <span className="text-[7pt] text-[#6b7280]">{proj.date}</span>}
                    </div>
                    {proj.tech.length>0 && <div className="flex flex-wrap gap-1 mt-[4px]">{proj.tech.map((t,j)=><span key={j} className="text-[7px] px-[6px] py-[2px] bg-white border border-[#C7D2FE] rounded-full font-medium text-[#2D4A9A]">{t}</span>)}</div>}
                    {proj.description && <p className="text-[7.8pt] text-[#1f2937] mt-[5px] leading-[1.45]">{proj.description}</p>}
                    {proj.link && <a href={proj.link} target="_blank" rel="noopener noreferrer" className="text-[7pt] text-[#2D4A9A] hover:underline break-all mt-[3px] inline-block">{proj.link}</a>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-[14px]">
          {data.skills.length>0 && (
            <section>
              <h2 className="text-[8.5pt] font-bold tracking-[0.14em] uppercase text-[#2D4A9A] flex items-center gap-2">
                <span className="w-[18px] h-[2px] bg-[#2D4A9A]" /> Skills
              </h2>
              <div className="h-[1px] bg-[#2D4A9A]/30 mt-[3px] mb-[8px]" />
              <div className="flex flex-wrap gap-[6px]">
                {data.skills.map((s,i)=>(
                  <span key={i} className="px-[8px] py-[3px] rounded-full bg-[#EEF1FF] border border-[#C7D2FE] text-[7.5pt] font-semibold text-[#2D4A9A]">{s}</span>
                ))}
              </div>
            </section>
          )}

          {data.education.length>0 && (
            <section>
              <h2 className="text-[8.5pt] font-bold tracking-[0.14em] uppercase text-[#2D4A9A] flex items-center gap-2">
                <span className="w-[18px] h-[2px] bg-[#2D4A9A]" /> Education
              </h2>
              <div className="h-[1px] bg-[#2D4A9A]/30 mt-[3px] mb-[8px]" />
              <div className="space-y-[10px]">
                {data.education.map(ed=>(
                  <div key={ed.id}>
                    <h3 className="font-bold text-[8.8pt] text-[#111827] leading-tight">{ed.degree}</h3>
                    <p className="text-[7.8pt] text-[#374151]">{ed.school}{ed.location ? `, ${ed.location}` : ''}</p>
                    <p className="text-[7pt] text-[#2D4A9A] font-medium">{formatDate(ed.startDate)} – {formatDate(ed.endDate)}</p>
                    {ed.cgpa && <p className="text-[7pt] text-[#6b7280]">CGPA: {ed.cgpa}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.certifications && data.certifications.length>0 && (
            <section>
              <h2 className="text-[8.5pt] font-bold tracking-[0.14em] uppercase text-[#2D4A9A] flex items-center gap-2">
                <span className="w-[18px] h-[2px] bg-[#2D4A9A]" /> Certifications
              </h2>
              <div className="h-[1px] bg-[#2D4A9A]/30 mt-[3px] mb-[8px]" />
              <div className="space-y-[8px]">
                {data.certifications.map(c=>(
                  <div key={c.id}>
                    <h3 className="font-bold text-[8pt] text-[#111827]">{c.name}</h3>
                    {c.issuer && <p className="text-[7.5pt] text-[#374151]">{c.issuer}</p>}
                    {c.date && <p className="text-[7pt] text-[#2D4A9A]">{c.date}</p>}
                    {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[7pt] text-[#2D4A9A] hover:underline break-all">{c.url}</a>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Contact card duplicate for AltaCV right sidebar feel */}
          {(p.links.length>0 || p.email) && (
            <section className="bg-[#F8F9FF] rounded-[10px] p-[10px] border border-[#E0E7FF]">
              <h2 className="text-[7.5pt] font-bold tracking-[0.12em] uppercase text-[#2D4A9A] mb-[6px]">Links</h2>
              <div className="space-y-[4px] text-[7.5pt]">
                {p.email && <a href={`mailto:${p.email}`} className="block text-[#2D4A9A] hover:underline break-all">✉ {p.email}</a>}
                {p.links.filter(l=>l.url).map((l,i)=>(
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="block text-[#2D4A9A] hover:underline break-all">↗ {l.label}: {l.url}</a>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="px-[28px] pb-[10px]">
        <p className="text-[6px] text-center text-[#9ca3af] tracking-wide">Overleaf-like AltaCV two-column — vector selectable (Modern)</p>
      </div>
    </div>
  )
}

/** Minimal — ATS Minimal clean (Overleaf mimic) */
function MinimalTemplate({ data }: { data: ResumeData }) {
  const p = data.personalInfo
  return (
    <div className="bg-white text-[#1f2937] p-[36px]" style={{ fontFamily: "'Inter','Helvetica Neue',Helvetica,Arial,sans-serif" }}>
      {/* Header left-aligned minimal */}
      <div className="mb-[10px]">
        <h1 className="text-[18pt] font-bold tracking-tight text-[#111827] leading-none">{p.fullName || 'Your Name'}</h1>
        {p.headline && <p className="text-[8.5pt] text-[#4b5563] mt-[4px] font-medium">{p.headline}</p>}
        <div className="flex flex-wrap gap-x-2 gap-y-1 mt-[6px] text-[7.5pt] text-[#6b7280]">
          {p.email && <span>{p.email}</span>}
          {p.phone && <><span className="text-[#d1d5db]">|</span><span>{p.phone}</span></>}
          {p.location && <><span className="text-[#d1d5db]">|</span><span>{p.location}</span></>}
          {p.links.filter(l=>l.url).map((l,i)=>(
            <span key={i} className="inline-flex items-center gap-1"><span className="text-[#d1d5db]">|</span><a href={l.url} target="_blank" rel="noopener noreferrer" className="text-[#374151] hover:underline">{l.label}</a></span>
          ))}
        </div>
      </div>
      <div className="h-[0.6px] bg-[#D1D5DB] mb-[12px]" />

      {p.summary && (
        <section className="mb-[12px]">
          <h2 className="text-[8pt] font-bold tracking-[0.16em] uppercase text-[#374151] mb-[3px]">Summary</h2>
          <div className="h-[0.6px] bg-[#D1D5DB] mb-[6px]" />
          <p className="text-[8.3pt] leading-[1.55] text-[#1f2937] whitespace-pre-wrap">{p.summary}</p>
        </section>
      )}

      {data.skills.length>0 && (
        <section className="mb-[12px]">
          <h2 className="text-[8pt] font-bold tracking-[0.16em] uppercase text-[#374151] mb-[3px]">Skills</h2>
          <div className="h-[0.6px] bg-[#D1D5DB] mb-[6px]" />
          <p className="text-[8.3pt] leading-[1.55] text-[#1f2937]">{data.skills.join(', ')}</p>
        </section>
      )}

      {data.experience.length>0 && (
        <section className="mb-[12px]">
          <h2 className="text-[8pt] font-bold tracking-[0.16em] uppercase text-[#374151] mb-[3px]">Experience</h2>
          <div className="h-[0.6px] bg-[#D1D5DB] mb-[8px]" />
          <div className="space-y-[10px]">
            {data.experience.map(exp=>(
              <div key={exp.id}>
                <div className="flex justify-between gap-3">
                  <h3 className="font-bold text-[9pt] text-[#111827]">{exp.role || 'Role'}</h3>
                  <span className="text-[7.5pt] text-[#6b7280] shrink-0">{formatDate(exp.startDate)} – {formatDate(exp.endDate)}</span>
                </div>
                <p className="text-[8pt] text-[#4b5563]">{exp.company}{exp.location ? ` | ${exp.location}` : ''}</p>
                {exp.bullets.filter(Boolean).length>0 && (
                  <ul className="mt-[4px] space-y-[2px] pl-[14px] list-disc marker:text-[#9ca3af]">
                    {exp.bullets.filter(Boolean).map((b,i)=>(<li key={i} className="text-[8.3pt] text-[#1f2937] leading-[1.5]">{b}</li>))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.projects.length>0 && (
        <section className="mb-[12px]">
          <h2 className="text-[8pt] font-bold tracking-[0.16em] uppercase text-[#374151] mb-[3px]">Projects</h2>
          <div className="h-[0.6px] bg-[#D1D5DB] mb-[8px]" />
          <div className="space-y-[8px]">
            {data.projects.map(proj=>(
              <div key={proj.id}>
                <div className="flex justify-between gap-2">
                  <h3 className="font-bold text-[9pt] text-[#111827]">{proj.title}</h3>
                  {proj.date && <span className="text-[7.5pt] text-[#6b7280]">{proj.date}</span>}
                </div>
                {proj.tech.length>0 && <p className="text-[7.5pt] italic text-[#6b7280] mt-[1px]">{proj.tech.join(', ')}</p>}
                {proj.description && <p className="text-[8.3pt] text-[#1f2937] mt-[3px] leading-[1.5]">{proj.description}</p>}
                {proj.link && <a href={proj.link} target="_blank" rel="noopener noreferrer" className="text-[7.5pt] text-[#374151] hover:underline break-all">{proj.link}</a>}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.education.length>0 && (
        <section className="mb-[12px]">
          <h2 className="text-[8pt] font-bold tracking-[0.16em] uppercase text-[#374151] mb-[3px]">Education</h2>
          <div className="h-[0.6px] bg-[#D1D5DB] mb-[8px]" />
          <div className="space-y-[8px]">
            {data.education.map(ed=>(
              <div key={ed.id} className="flex justify-between gap-3">
                <div>
                  <h3 className="font-bold text-[9pt] text-[#111827]">{ed.degree || 'Degree'}</h3>
                  <p className="text-[8pt] text-[#4b5563]">{ed.school}{ed.location ? `, ${ed.location}` : ''}</p>
                  {ed.cgpa && <p className="text-[7.5pt] text-[#6b7280]">CGPA: {ed.cgpa}</p>}
                </div>
                <span className="text-[7.5pt] text-[#6b7280] shrink-0">{formatDate(ed.startDate)} – {formatDate(ed.endDate)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.certifications && data.certifications.length>0 && (
        <section className="mb-[2px]">
          <h2 className="text-[8pt] font-bold tracking-[0.16em] uppercase text-[#374151] mb-[3px]">Certifications</h2>
          <div className="h-[0.6px] bg-[#D1D5DB] mb-[8px]" />
          <div className="space-y-[8px]">
            {data.certifications.map(c=>(
              <div key={c.id} className="flex justify-between gap-3">
                <div>
                  <h3 className="font-bold text-[9pt] text-[#111827]">{c.name}{c.issuer ? <span className="font-normal text-[#4b5563]"> — {c.issuer}</span> : null}</h3>
                  {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[7.5pt] text-[#374151] hover:underline break-all">{c.url}</a>}
                </div>
                {c.date && <span className="text-[7.5pt] text-[#6b7280] shrink-0">{c.date}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[6px] text-center text-[#9ca3af] mt-[14px] tracking-wide">Overleaf-like ATS Minimal — vector selectable (Minimal)</p>
    </div>
  )
}

/** Source Sans Split — Exact Overleaf PDF replica (monochrome, 0.5in, 10pt body/12pt h2/24.8pt name) */
function SourceSplitTemplate({ data }: { data: ResumeData }) {
  const p = data.personalInfo
  const skillRows = parseSkillRows(data.skills)
  const hasLinks = data.personalInfo.links.some(l => l.url?.trim())
  return (
    <div
      className="bg-white text-black antialiased"
      style={{
        fontFamily: "'Source Sans Pro','Source Sans 3','Source Sans', Helvetica, Arial, sans-serif",
        padding: '0.5in',
        fontSize: '10pt',
        lineHeight: 1.45,
        color: '#000000',
      }}
    >
      {/* Inject Source Sans Pro via Google Fonts if not already present */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap');`}</style>

      {/* Header — split left/right */}
      <div className="flex justify-between items-start gap-4">
        <h1
          className="font-bold uppercase tracking-tight leading-none"
          style={{ fontFamily: "'Source Sans 3','Source Sans Pro', sans-serif", fontSize: '24.8pt', lineHeight: 1, letterSpacing: '-0.01em' }}
        >
          {p.fullName || 'Jane Doe'}
        </h1>
        {p.location?.trim() && (
          <span className="shrink-0 text-right pt-[8px] text-black" style={{ fontSize: '9.5pt', lineHeight: 1.2 }}>
            {p.location}
          </span>
        )}
      </div>

      {/* Links left | email/phone right */}
      <div className="flex justify-between items-baseline gap-4 mt-[4px] text-black" style={{ fontSize: '8.5pt', lineHeight: 1.3 }}>
        <div className="flex flex-wrap items-center gap-x-1 min-w-0">
          {p.links
            .filter(l => l.url?.trim())
            .map((l, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-black px-[1px]">|</span>}
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 decoration-black text-black hover:text-black"
                  style={{ textDecorationThickness: '0.4pt', textUnderlineOffset: '2px' }}
                >
                  {l.label}
                </a>
              </span>
            ))}
          {!hasLinks && <span className="text-[#9ca3af] text-[8pt]">Add links (GitHub, LinkedIn…)</span>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-1 shrink-0 text-right">
          {p.email?.trim() && (
            <a
              href={`mailto:${p.email.trim()}`}
              className="underline underline-offset-2 decoration-black text-black"
              style={{ textDecorationThickness: '0.4pt', textUnderlineOffset: '2px' }}
            >
              {p.email.trim()}
            </a>
          )}
          {p.email?.trim() && p.phone?.trim() && <span className="text-black">|</span>}
          {p.phone?.trim() && <span className="text-black">{p.phone.trim()}</span>}
        </div>
      </div>

      {/* Hairline 0.4pt */}
      <div className="bg-black mt-[6px] mb-[6px]" style={{ height: '0.4pt' }} />

      {/* Headline FULL STACK DEVELOPER left */}
      {p.headline?.trim() ? (
        <p
          className="font-semibold uppercase text-black tracking-wide"
          style={{ fontSize: '10pt', letterSpacing: '0.06em', lineHeight: 1.2 }}
        >
          {p.headline.trim()}
        </p>
      ) : (
        <p className="uppercase tracking-wide text-black" style={{ fontSize: '10pt', letterSpacing: '0.06em' }}>
          FULL STACK DEVELOPER
        </p>
      )}

      {/* Summary if exists — dense */}
      {p.summary?.trim() && (
        <section className="mt-[10px]">
          <h2 className="font-bold uppercase text-black tracking-tight" style={{ fontSize: '12pt', lineHeight: 1, letterSpacing: '0.01em' }}>
            Summary
          </h2>
          <div className="bg-black mt-[4px] mb-[6px]" style={{ height: '0.4pt' }} />
          <p className="whitespace-pre-wrap text-black" style={{ fontSize: '10pt', lineHeight: 1.45 }}>
            {p.summary.trim()}
          </p>
        </section>
      )}

      {/* Technical Skills — categorized table */}
      {(skillRows.length > 0 || data.skills.length > 0) && (
        <section className="mt-[10px]">
          <h2 className="font-bold uppercase text-black tracking-tight" style={{ fontSize: '12pt', lineHeight: 1 }}>
            Technical Skills
          </h2>
          <div className="bg-black mt-[4px] mb-[6px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[2px]">
            {skillRows.length > 0 ? (
              skillRows.map((row, idx) => (
                <div key={idx} className="flex gap-3" style={{ fontSize: '9.5pt', lineHeight: 1.45 }}>
                  <span className="font-bold shrink-0 text-black" style={{ width: '138px', fontSize: '9.5pt' }}>
                    {row.label}:
                  </span>
                  <span className="flex-1 text-black" style={{ fontSize: '9.5pt' }}>
                    {row.value}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-black" style={{ fontSize: '9.5pt' }}>{data.skills.join(', ')}</p>
            )}
          </div>
        </section>
      )}

      {/* Experience — 2-line (Role vs Date, Company vs Location) */}
      {data.experience.length > 0 && (
        <section className="mt-[10px]">
          <h2 className="font-bold uppercase text-black" style={{ fontSize: '12pt', lineHeight: 1 }}>
            Experience
          </h2>
          <div className="bg-black mt-[4px] mb-[6px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[9px]">
            {data.experience.map(exp => (
              <div key={exp.id}>
                <div className="flex justify-between gap-2 items-baseline">
                  <span className="font-bold text-black" style={{ fontSize: '10pt', lineHeight: 1.2 }}>
                    {exp.role || 'Role'}
                  </span>
                  <span className="shrink-0 italic text-black" style={{ fontSize: '9.5pt' }}>
                    {formatDate(exp.startDate)} – {formatDate(exp.endDate)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 items-baseline -mt-[1px]">
                  <span className="italic text-black" style={{ fontSize: '9.5pt' }}>
                    {exp.company || 'Company'}
                  </span>
                  <span className="italic text-black shrink-0" style={{ fontSize: '9.5pt' }}>
                    {exp.location || ''}
                  </span>
                </div>
                {exp.bullets.filter(Boolean).length > 0 && (
                  <ul className="list-disc pl-[14px] mt-[3px] space-y-[2px] marker:text-black">
                    {exp.bullets.filter(Boolean).map((b, i) => (
                      <li key={i} className="text-black" style={{ fontSize: '9.5pt', lineHeight: 1.45 }}>
                        <BoldKeyword text={b} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Projects — title left + tech middle + Source Code right */}
      {data.projects.length > 0 && (
        <section className="mt-[10px]">
          <h2 className="font-bold uppercase text-black" style={{ fontSize: '12pt', lineHeight: 1 }}>
            Projects
          </h2>
          <div className="bg-black mt-[4px] mb-[6px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[9px]">
            {data.projects.map(proj => (
              <div key={proj.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="font-bold text-black shrink-0" style={{ fontSize: '10pt' }}>
                    {proj.title || 'Untitled Project'}
                  </span>
                  {proj.tech.length > 0 && (
                    <span className="flex-1 text-center italic text-black px-2 truncate" style={{ fontSize: '8.5pt' }}>
                      {proj.tech.join(' · ')}
                    </span>
                  )}
                  {proj.link?.trim() ? (
                    <a
                      href={proj.link.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 decoration-black text-black shrink-0"
                      style={{ fontSize: '8.5pt', textDecorationThickness: '0.4pt' }}
                    >
                      Source Code
                    </a>
                  ) : proj.date ? (
                    <span className="shrink-0 italic text-black" style={{ fontSize: '8.5pt' }}>
                      {proj.date}
                    </span>
                  ) : null}
                </div>
                {proj.description?.trim() && (
                  <p className="mt-[2px] text-black" style={{ fontSize: '9.5pt', lineHeight: 1.45 }}>
                    {proj.description.trim()}
                  </p>
                )}
                {/* If project has tech but no Source Code link, show link underneath as fallback */}
                {proj.link?.trim() && proj.description?.trim() ? null : proj.link?.trim() && !proj.tech.length ? (
                  <a href={proj.link.trim()} target="_blank" rel="noopener noreferrer" className="text-black underline break-all" style={{ fontSize: '8pt' }}>
                    {proj.link.trim()}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Education — same 2-line pattern */}
      {data.education.length > 0 && (
        <section className="mt-[10px]">
          <h2 className="font-bold uppercase text-black" style={{ fontSize: '12pt', lineHeight: 1 }}>
            Education
          </h2>
          <div className="bg-black mt-[4px] mb-[6px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[7px]">
            {data.education.map(ed => (
              <div key={ed.id}>
                <div className="flex justify-between gap-2 items-baseline">
                  <span className="font-bold text-black" style={{ fontSize: '10pt' }}>
                    {ed.degree || 'Degree'}
                  </span>
                  <span className="shrink-0 italic text-black" style={{ fontSize: '9.5pt' }}>
                    {formatDate(ed.startDate)} – {formatDate(ed.endDate)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 items-baseline -mt-[1px]">
                  <span className="italic text-black" style={{ fontSize: '9.5pt' }}>
                    {ed.school}
                    {ed.location ? ` — ${ed.location}` : ''}
                    {ed.cgpa ? ` · CGPA: ${ed.cgpa}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Certifications */}
      {data.certifications && data.certifications.length > 0 && (
        <section className="mt-[10px]">
          <h2 className="font-bold uppercase text-black" style={{ fontSize: '12pt', lineHeight: 1 }}>
            Certifications
          </h2>
          <div className="bg-black mt-[4px] mb-[6px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[6px]">
            {data.certifications.map(c => (
              <div key={c.id} className="flex justify-between gap-2 items-baseline">
                <div className="min-w-0">
                  <span className="font-bold text-black" style={{ fontSize: '10pt' }}>
                    {c.name}
                  </span>
                  {c.issuer && <span className="italic text-black" style={{ fontSize: '9.5pt' }}> — {c.issuer}</span>}
                  {c.url && (
                    <span className="ml-2">
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline text-black" style={{ fontSize: '8pt' }}>
                        Verify
                      </a>
                    </span>
                  )}
                </div>
                {c.date && <span className="shrink-0 italic text-black" style={{ fontSize: '9.5pt' }}>{c.date}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-center mt-[14px] tracking-wide" style={{ fontSize: '6pt', color: '#9ca3af' }}>
        Monochrome · 0.4pt hairlines · Source Sans Pro · dense 1-page
      </p>
    </div>
  )
}

/** Compact ATS — dense monochrome single-col, Source Sans, tight spacing for 1-page ATS */
function CompactTemplate({ data }: { data: ResumeData }) {
  const p = data.personalInfo
  const skillRows = parseSkillRows(data.skills)
  return (
    <div
      className="bg-white text-black"
      style={{
        fontFamily: "'Source Sans Pro','Source Sans 3','Inter',Helvetica,Arial,sans-serif",
        padding: '0.5in',
        fontSize: '9.5pt',
        lineHeight: 1.35,
        color: '#000000',
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap');`}</style>

      {/* Header — dense stacked centered for ATS, but split variant for compact */}
      <div className="text-center">
        <h1 className="font-bold uppercase tracking-tight leading-none text-black" style={{ fontFamily: "'Source Sans 3','Source Sans Pro', sans-serif", fontSize: '20pt', letterSpacing: '0.02em' }}>
          {p.fullName || 'Your Name'}
        </h1>
        {p.headline?.trim() ? (
          <p className="font-semibold uppercase tracking-widest text-black mt-[3px]" style={{ fontSize: '8.5pt', letterSpacing: '0.14em' }}>{p.headline.trim()}</p>
        ) : (
          <p className="font-semibold uppercase tracking-widest text-black mt-[3px]" style={{ fontSize: '8.5pt', letterSpacing: '0.14em' }}>STUDENT · DEVELOPER</p>
        )}
        <div className="flex flex-wrap justify-center gap-x-1 gap-y-1 mt-[5px] text-black" style={{ fontSize: '8pt' }}>
          {p.email?.trim() && <a href={`mailto:${p.email.trim()}`} className="underline decoration-black text-black" style={{ textDecorationThickness: '0.4pt' }}>{p.email.trim()}</a>}
          {p.email?.trim() && p.phone?.trim() && <span className="text-black">|</span>}
          {p.phone?.trim() && <span>{p.phone.trim()}</span>}
          {p.location?.trim() && <><span className="text-black">|</span><span>{p.location.trim()}</span></>}
          {p.links.filter(l=>l.url?.trim()).map((l,i)=>(
            <span key={i} className="inline-flex items-center gap-1">
              <span className="text-black">|</span>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline decoration-black text-black" style={{ textDecorationThickness: '0.4pt' }}>{l.label}</a>
            </span>
          ))}
        </div>
      </div>

      <div className="bg-black mt-[7px] mb-[6px]" style={{ height: '0.4pt' }} />

      {p.summary?.trim() && (
        <section className="mb-[8px]">
          <h2 className="font-bold uppercase tracking-wide text-black" style={{ fontSize: '10.5pt', letterSpacing: '0.08em', lineHeight: 1 }}>Summary</h2>
          <div className="bg-black mt-[3px] mb-[5px]" style={{ height: '0.4pt' }} />
          <p className="whitespace-pre-wrap text-black" style={{ fontSize: '9pt', lineHeight: 1.4 }}>{p.summary.trim()}</p>
        </section>
      )}

      {(skillRows.length>0 || data.skills.length>0) && (
        <section className="mb-[8px]">
          <h2 className="font-bold uppercase tracking-wide text-black" style={{ fontSize: '10.5pt', letterSpacing: '0.08em', lineHeight: 1 }}>Skills</h2>
          <div className="bg-black mt-[3px] mb-[5px]" style={{ height: '0.4pt' }} />
          {skillRows.length === 1 && skillRows[0].label === 'Skills' ? (
            <p className="text-black" style={{ fontSize: '9pt', lineHeight: 1.4 }}>{skillRows[0].value}</p>
          ) : (
            <div className="space-y-[1px]">
              {skillRows.map((r,i)=>(
                <div key={i} className="flex gap-2" style={{ fontSize: '9pt', lineHeight: 1.4 }}>
                  <span className="font-bold shrink-0 text-black" style={{ minWidth: '112px' }}>{r.label}:</span>
                  <span className="flex-1 text-black">{r.value}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {data.experience.length>0 && (
        <section className="mb-[8px]">
          <h2 className="font-bold uppercase tracking-wide text-black" style={{ fontSize: '10.5pt', letterSpacing: '0.08em', lineHeight: 1 }}>Experience</h2>
          <div className="bg-black mt-[3px] mb-[5px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[7px]">
            {data.experience.map(exp=>(
              <div key={exp.id}>
                <div className="flex justify-between gap-2 items-baseline">
                  <span className="font-bold text-black" style={{ fontSize: '9.5pt' }}>{exp.role || 'Role'} — <span className="font-normal italic">{exp.company || 'Company'}{exp.location ? ` · ${exp.location}` : ''}</span></span>
                  <span className="shrink-0 text-black" style={{ fontSize: '8pt' }}>{formatDate(exp.startDate)} – {formatDate(exp.endDate)}</span>
                </div>
                {exp.bullets.filter(Boolean).length>0 && (
                  <ul className="list-disc pl-[13px] mt-[2px] space-y-[1px] marker:text-black">
                    {exp.bullets.filter(Boolean).map((b,i)=>(
                      <li key={i} className="text-black" style={{ fontSize: '9pt', lineHeight: 1.35 }}><BoldKeyword text={b} /></li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.projects.length>0 && (
        <section className="mb-[8px]">
          <h2 className="font-bold uppercase tracking-wide text-black" style={{ fontSize: '10.5pt', letterSpacing: '0.08em', lineHeight: 1 }}>Projects</h2>
          <div className="bg-black mt-[3px] mb-[5px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[6px]">
            {data.projects.map(proj=>(
              <div key={proj.id}>
                <div className="flex justify-between gap-2 items-baseline">
                  <span className="font-bold text-black" style={{ fontSize: '9.5pt' }}>{proj.title || 'Untitled'}</span>
                  <span className="shrink-0 text-black" style={{ fontSize: '8pt' }}>{proj.date || ''}</span>
                </div>
                {proj.tech.length>0 && <p className="italic text-black" style={{ fontSize: '8pt' }}>{proj.tech.join(' · ')}</p>}
                {proj.description?.trim() && <p className="text-black mt-[1px]" style={{ fontSize: '9pt', lineHeight: 1.35 }}>{proj.description.trim()}</p>}
                {proj.link?.trim() && <a href={proj.link.trim()} target="_blank" rel="noopener noreferrer" className="underline decoration-black text-black break-all" style={{ fontSize: '8pt' }}>{proj.link.trim()}</a>}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.education.length>0 && (
        <section className="mb-[8px]">
          <h2 className="font-bold uppercase tracking-wide text-black" style={{ fontSize: '10.5pt', letterSpacing: '0.08em', lineHeight: 1 }}>Education</h2>
          <div className="bg-black mt-[3px] mb-[5px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[5px]">
            {data.education.map(ed=>(
              <div key={ed.id} className="flex justify-between gap-2">
                <div>
                  <span className="font-bold text-black" style={{ fontSize: '9.5pt' }}>{ed.degree || 'Degree'}</span>
                  <span className="text-black" style={{ fontSize: '9pt' }}> — {ed.school}{ed.location ? `, ${ed.location}` : ''}{ed.cgpa ? ` · CGPA ${ed.cgpa}` : ''}</span>
                </div>
                <span className="shrink-0 text-black" style={{ fontSize: '8pt' }}>{formatDate(ed.startDate)} – {formatDate(ed.endDate)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.certifications && data.certifications.length>0 && (
        <section className="mb-[2px]">
          <h2 className="font-bold uppercase tracking-wide text-black" style={{ fontSize: '10.5pt', letterSpacing: '0.08em', lineHeight: 1 }}>Certifications</h2>
          <div className="bg-black mt-[3px] mb-[5px]" style={{ height: '0.4pt' }} />
          <div className="space-y-[4px]">
            {data.certifications.map(c=>(
              <div key={c.id} className="flex justify-between gap-2 items-baseline">
                <span className="text-black" style={{ fontSize: '9pt' }}><span className="font-bold">{c.name}</span>{c.issuer ? ` — ${c.issuer}` : ''}{c.url ? ` · ` : ''}{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline decoration-black">{c.url}</a> : null}</span>
                {c.date && <span className="shrink-0 text-black" style={{ fontSize: '8pt' }}>{c.date}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-center mt-[10px] tracking-wide" style={{ fontSize: '6pt', color: '#9ca3af' }}>Compact ATS · monochrome · 0.4pt · dense</p>
    </div>
  )
}

const ResumePreview = forwardRef<HTMLDivElement, Props>(({ data, template }, ref) => {
  const tpl: ResumeTemplateId = template || data.template || 'source-split'
  return (
    <div
      ref={ref}
      id="resume-print-root"
      className="resume-print-root bg-white rounded-xl overflow-hidden shadow-sm border border-surface-200 w-full max-w-[800px] mx-auto print:shadow-none print:border-0 print:rounded-none"
      style={{ colorScheme: 'light' }}
    >
      {tpl === 'source-split' && <SourceSplitTemplate data={data} />}
      {tpl === 'compact' && <CompactTemplate data={data} />}
      {tpl === 'classic' && <ClassicTemplate data={data} />}
      {tpl === 'modern' && <ModernTemplate data={data} />}
      {tpl === 'minimal' && <MinimalTemplate data={data} />}
    </div>
  )
})

ResumePreview.displayName = 'ResumePreview'
export default ResumePreview
