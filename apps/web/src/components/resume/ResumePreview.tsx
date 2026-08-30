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

const hasLinks = (d: ResumeData) => d.personalInfo.links.some(l => l.url?.trim())

function ClassicTemplate({ data }: { data: ResumeData }) {
  const p = data.personalInfo
  return (
    <div className="bg-white text-surface-900 p-8 leading-relaxed text-[13px]">
      {/* Header */}
      <div className="text-center border-b border-surface-200 pb-5 mb-5">
        <h1 className="text-2xl font-extrabold tracking-tight text-surface-900">{p.fullName || 'Your Name'}</h1>
        {p.headline && <p className="text-sm font-medium text-primary-600 mt-1">{p.headline}</p>}
        <div className="flex flex-wrap justify-center gap-2 mt-2 text-xs text-surface-500">
          {p.email && <span>{p.email}</span>}
          {p.phone && <><span>·</span><span>{p.phone}</span></>}
          {p.location && <><span>·</span><span>{p.location}</span></>}
        </div>
        {hasLinks(data) && (
          <div className="flex flex-wrap justify-center gap-3 mt-1 text-xs">
            {p.links.filter(l=>l.url).map((l,i)=>(
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">{l.label}</a>
            ))}
          </div>
        )}
      </div>

      {p.summary && (
        <section className="mb-5">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-surface-400 border-b border-surface-200 pb-1 mb-2">Summary</h2>
          <p className="text-sm leading-relaxed text-surface-700">{p.summary}</p>
        </section>
      )}

      {data.skills.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-surface-400 border-b border-surface-200 pb-1 mb-2">Skills</h2>
          <div className="flex flex-wrap gap-1.5">
            {data.skills.map((s,i)=>(
              <span key={i} className="px-2.5 py-1 rounded-full bg-surface-100 border border-surface-200 text-xs font-medium text-surface-700">{s}</span>
            ))}
          </div>
        </section>
      )}

      {data.projects.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-surface-400 border-b border-surface-200 pb-1 mb-2">Projects</h2>
          <div className="space-y-3">
            {data.projects.map(proj=>(
              <div key={proj.id}>
                <div className="flex justify-between items-baseline gap-2">
                  <h3 className="font-bold text-sm text-surface-900">{proj.title || 'Untitled Project'}</h3>
                  {proj.date && <span className="text-xs text-surface-400 shrink-0">{proj.date}</span>}
                </div>
                {proj.tech.length>0 && <p className="text-xs text-primary-600 mt-0.5">{proj.tech.join(' · ')}</p>}
                {proj.description && <p className="text-xs text-surface-600 mt-1 leading-relaxed">{proj.description}</p>}
                {proj.link && <a href={proj.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline">{proj.link}</a>}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.experience.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-surface-400 border-b border-surface-200 pb-1 mb-2">Experience</h2>
          <div className="space-y-3">
            {data.experience.map(exp=>(
              <div key={exp.id}>
                <div className="flex justify-between gap-2">
                  <h3 className="font-bold text-sm text-surface-900">{exp.role || 'Role'} <span className="font-normal text-surface-600">— {exp.company || 'Company'}</span></h3>
                  <span className="text-xs text-surface-400 shrink-0">{formatDate(exp.startDate)} – {formatDate(exp.endDate)}</span>
                </div>
                {exp.location && <p className="text-xs text-surface-400">{exp.location}</p>}
                {exp.bullets.filter(Boolean).length>0 && (
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {exp.bullets.filter(Boolean).map((b,i)=>(<li key={i} className="text-xs text-surface-600">{b}</li>))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.education.length > 0 && (
        <section className="mb-2">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-surface-400 border-b border-surface-200 pb-1 mb-2">Education</h2>
          <div className="space-y-3">
            {data.education.map(ed=>(
              <div key={ed.id} className="flex justify-between gap-2">
                <div>
                  <h3 className="font-bold text-sm text-surface-900">{ed.degree || 'Degree'}</h3>
                  <p className="text-xs text-surface-600">{ed.school}{ed.location ? ` · ${ed.location}` : ''}</p>
                  {ed.cgpa && <p className="text-xs text-surface-500">CGPA: {ed.cgpa}</p>}
                </div>
                <span className="text-xs text-surface-400 shrink-0">{formatDate(ed.startDate)} – {formatDate(ed.endDate)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ModernTemplate({ data }: { data: ResumeData }) {
  const p = data.personalInfo
  return (
    <div className="bg-white text-surface-900 overflow-hidden rounded-[8px]">
      {/* Top bar */}
      <div className="bg-primary-600 text-white px-8 py-6">
        <h1 className="text-2xl font-extrabold tracking-tight">{p.fullName || 'Your Name'}</h1>
        {p.headline && <p className="text-sm font-medium text-primary-100 mt-1">{p.headline}</p>}
        <div className="flex flex-wrap gap-2 mt-3 text-xs text-primary-100">
          {p.email && <span className="bg-white/15 px-2 py-1 rounded-full">{p.email}</span>}
          {p.phone && <span className="bg-white/15 px-2 py-1 rounded-full">{p.phone}</span>}
          {p.location && <span className="bg-white/15 px-2 py-1 rounded-full">{p.location}</span>}
        </div>
        {hasLinks(data) && (
          <div className="flex flex-wrap gap-2 mt-2">
            {p.links.filter(l=>l.url).map((l,i)=>(
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs underline decoration-white/40 hover:text-white">{l.label}</a>
            ))}
          </div>
        )}
      </div>

      <div className="p-8 space-y-5 text-[13px]">
        {p.summary && (
          <section>
            <h2 className="text-xs font-bold tracking-widest uppercase text-primary-600 flex items-center gap-2">
              <span className="w-6 h-0.5 bg-primary-600" /> Summary
            </h2>
            <p className="text-sm leading-relaxed text-surface-700 mt-2">{p.summary}</p>
          </section>
        )}

        {data.skills.length>0 && (
          <section>
            <h2 className="text-xs font-bold tracking-widest uppercase text-primary-600 flex items-center gap-2">
              <span className="w-6 h-0.5 bg-primary-600" /> Skills
            </h2>
            <div className="flex flex-wrap gap-2 mt-2">
              {data.skills.map((s,i)=>(
                <span key={i} className="px-3 py-1 rounded-full bg-primary-50 border border-primary-100 text-xs font-semibold text-primary-700">{s}</span>
              ))}
            </div>
          </section>
        )}

        {data.projects.length>0 && (
          <section>
            <h2 className="text-xs font-bold tracking-widest uppercase text-primary-600 flex items-center gap-2">
              <span className="w-6 h-0.5 bg-primary-600" /> Projects
            </h2>
            <div className="space-y-3 mt-2">
              {data.projects.map(proj=>(
                <div key={proj.id} className="border border-surface-100 rounded-xl p-3 bg-surface-50/50">
                  <div className="flex justify-between gap-2">
                    <h3 className="font-bold text-sm">{proj.title || 'Untitled'}</h3>
                    {proj.date && <span className="text-xs text-surface-400">{proj.date}</span>}
                  </div>
                  {proj.tech.length>0 && <div className="flex flex-wrap gap-1 mt-1">{proj.tech.map((t,j)=><span key={j} className="text-[10px] px-1.5 py-0.5 bg-white border border-surface-200 rounded font-medium text-surface-600">{t}</span>)}</div>}
                  {proj.description && <p className="text-xs text-surface-600 mt-1">{proj.description}</p>}
                  {proj.link && <a href={proj.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline">{proj.link}</a>}
                </div>
              ))}
            </div>
          </section>
        )}

        {data.experience.length>0 && (
          <section>
            <h2 className="text-xs font-bold tracking-widest uppercase text-primary-600 flex items-center gap-2">
              <span className="w-6 h-0.5 bg-primary-600" /> Experience
            </h2>
            <div className="space-y-3 mt-2">
              {data.experience.map(exp=>(
                <div key={exp.id} className="relative pl-4 border-l-2 border-primary-100">
                  <div className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-primary-600 border-2 border-white" />
                  <div className="flex justify-between gap-2">
                    <h3 className="font-bold text-sm">{exp.role || 'Role'} <span className="font-normal text-surface-500">· {exp.company}</span></h3>
                    <span className="text-xs text-surface-400">{formatDate(exp.startDate)} – {formatDate(exp.endDate)}</span>
                  </div>
                  {exp.location && <p className="text-xs text-surface-400">{exp.location}</p>}
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {exp.bullets.filter(Boolean).map((b,i)=>(<li key={i} className="text-xs text-surface-600">{b}</li>))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.education.length>0 && (
          <section>
            <h2 className="text-xs font-bold tracking-widest uppercase text-primary-600 flex items-center gap-2">
              <span className="w-6 h-0.5 bg-primary-600" /> Education
            </h2>
            <div className="space-y-2 mt-2">
              {data.education.map(ed=>(
                <div key={ed.id} className="flex justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-sm">{ed.degree}</h3>
                    <p className="text-xs text-surface-600">{ed.school}{ed.location ? ` · ${ed.location}` : ''}{ed.cgpa ? ` · CGPA ${ed.cgpa}` : ''}</p>
                  </div>
                  <span className="text-xs text-surface-400">{formatDate(ed.startDate)} – {formatDate(ed.endDate)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function MinimalSidebarTemplate({ data }: { data: ResumeData }) {
  const p = data.personalInfo
  return (
    <div className="bg-white text-surface-900 flex min-h-[600px]">
      {/* Sidebar */}
      <div className="w-[32%] bg-surface-900 text-white p-6 flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-extrabold leading-tight">{p.fullName || 'Your Name'}</h1>
          {p.headline && <p className="text-xs text-surface-300 mt-1 leading-relaxed">{p.headline}</p>}
        </div>

        <div className="space-y-3 text-xs">
          <h2 className="text-[10px] font-bold tracking-widest uppercase text-surface-400">Contact</h2>
          <div className="space-y-1 text-surface-200">
            {p.email && <p className="break-all">{p.email}</p>}
            {p.phone && <p>{p.phone}</p>}
            {p.location && <p>{p.location}</p>}
            {p.links.filter(l=>l.url).map((l,i)=>(
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="block text-primary-300 hover:text-white break-all">{l.label}: {l.url}</a>
            ))}
          </div>
        </div>

        {data.skills.length>0 && (
          <div>
            <h2 className="text-[10px] font-bold tracking-widest uppercase text-surface-400 mb-2">Skills</h2>
            <div className="flex flex-wrap gap-1.5">
              {data.skills.map((s,i)=>(
                <span key={i} className="px-2 py-1 rounded bg-white/10 border border-white/15 text-[11px] font-medium text-white">{s}</span>
              ))}
            </div>
          </div>
        )}

        {data.education.length>0 && (
          <div>
            <h2 className="text-[10px] font-bold tracking-widest uppercase text-surface-400 mb-2">Education</h2>
            <div className="space-y-3">
              {data.education.map(ed=>(
                <div key={ed.id}>
                  <p className="text-xs font-bold text-white leading-tight">{ed.degree}</p>
                  <p className="text-xs text-surface-300">{ed.school}</p>
                  <p className="text-[11px] text-surface-400">{formatDate(ed.startDate)} – {formatDate(ed.endDate)}{ed.cgpa ? ` · ${ed.cgpa}` : ''}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main */}
      <div className="flex-1 p-6 space-y-5 text-[13px]">
        {p.summary && (
          <section>
            <h2 className="text-[11px] font-bold tracking-widest uppercase text-surface-400 border-b border-surface-100 pb-1 mb-2">About</h2>
            <p className="text-sm leading-relaxed text-surface-700">{p.summary}</p>
          </section>
        )}

        {data.experience.length>0 && (
          <section>
            <h2 className="text-[11px] font-bold tracking-widest uppercase text-surface-400 border-b border-surface-100 pb-1 mb-2">Experience</h2>
            <div className="space-y-4">
              {data.experience.map(exp=>(
                <div key={exp.id}>
                  <div className="flex justify-between gap-2">
                    <h3 className="font-bold text-sm">{exp.role || 'Role'}</h3>
                    <span className="text-xs text-surface-400">{formatDate(exp.startDate)} – {formatDate(exp.endDate)}</span>
                  </div>
                  <p className="text-xs font-medium text-primary-600">{exp.company}{exp.location ? ` · ${exp.location}` : ''}</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    {exp.bullets.filter(Boolean).map((b,i)=><li key={i} className="text-xs text-surface-600">{b}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.projects.length>0 && (
          <section>
            <h2 className="text-[11px] font-bold tracking-widest uppercase text-surface-400 border-b border-surface-100 pb-1 mb-2">Projects</h2>
            <div className="space-y-3">
              {data.projects.map(proj=>(
                <div key={proj.id}>
                  <div className="flex justify-between gap-2">
                    <h3 className="font-bold text-sm">{proj.title}</h3>
                    {proj.date && <span className="text-xs text-surface-400">{proj.date}</span>}
                  </div>
                  {proj.tech.length>0 && <p className="text-xs text-surface-500">{proj.tech.join(' · ')}</p>}
                  {proj.description && <p className="text-xs text-surface-600 mt-1">{proj.description}</p>}
                  {proj.link && <a href={proj.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline">{proj.link}</a>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

const ResumePreview = forwardRef<HTMLDivElement, Props>(({ data, template }, ref) => {
  const tpl: ResumeTemplateId = template || data.template || 'classic'
  return (
    <div
      ref={ref}
      className="bg-white rounded-xl overflow-hidden shadow-sm border border-surface-200 w-full max-w-[800px] mx-auto"
      style={{ colorScheme: 'light' }}
    >
      {tpl === 'classic' && <ClassicTemplate data={data} />}
      {tpl === 'modern' && <ModernTemplate data={data} />}
      {tpl === 'minimal' && <MinimalSidebarTemplate data={data} />}
    </div>
  )
})

ResumePreview.displayName = 'ResumePreview'
export default ResumePreview
