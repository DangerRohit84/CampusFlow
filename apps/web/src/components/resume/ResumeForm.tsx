import { useState } from 'react'
import { Plus, Trash2, X, ChevronDown, Link as LinkIcon, GraduationCap, Briefcase, FolderKanban, User, Sparkles } from 'lucide-react'
import type { ResumeData, ResumeTemplateId } from '../../types/resume'
import { RESUME_TEMPLATES } from '../../types/resume'

type Props = {
  data: ResumeData
  onChange: (next: ResumeData) => void
}

function Section({ title, icon, children, defaultOpen=false }: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 overflow-hidden">
      <button onClick={()=>setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-50 dark:hover:bg-night-700 transition-colors">
        <span className="w-8 h-8 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center text-primary-600 dark:text-primary-300">{icon}</span>
        <span className="flex-1 font-semibold text-sm text-surface-900 dark:text-night-50">{title}</span>
        <ChevronDown size={16} className={`text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-surface-100 dark:border-night-700 space-y-3">{children}</div>}
    </div>
  )
}

function Input({ label, value, onChange, placeholder, type='text' }: { label: string; value: string; onChange:(v:string)=>void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-surface-600 dark:text-night-300 mb-1 block">{label}</span>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type}
        className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400" />
    </label>
  )
}
function Textarea({ label, value, onChange, placeholder, rows=3 }: { label:string; value:string; onChange:(v:string)=>void; placeholder?:string; rows?:number }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-surface-600 dark:text-night-300 mb-1 block">{label}</span>
      <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows}
        className="w-full px-3 py-2.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none" />
    </label>
  )
}

export default function ResumeForm({ data, onChange }: Props) {
  const [skillInput, setSkillInput] = useState('')

  const update = (patch: Partial<ResumeData>) => onChange({ ...data, ...patch, updatedAt: new Date().toISOString() })
  const updatePersonal = (patch: Partial<ResumeData['personalInfo']>) => update({ personalInfo: { ...data.personalInfo, ...patch } })

  const addSkill = () => {
    const v = skillInput.trim()
    if (!v) return
    if (data.skills.includes(v)) { setSkillInput(''); return }
    update({ skills: [...data.skills, v] })
    setSkillInput('')
  }

  const addProject = () => {
    update({ projects: [...data.projects, { id: Date.now().toString(), title:'', description:'', tech:[], link:'', date:'' }] })
  }
  const updateProject = (id:string, patch: Partial<ResumeData['projects'][number]>) => {
    update({ projects: data.projects.map(p=> p.id===id ? { ...p, ...patch } : p) })
  }
  const removeProject = (id:string) => update({ projects: data.projects.filter(p=>p.id!==id) })

  const addExperience = () => {
    update({ experience: [...data.experience, { id: Date.now().toString(), role:'', company:'', location:'', startDate:'', endDate:'', bullets:[''] }] })
  }
  const updateExp = (id:string, patch: Partial<ResumeData['experience'][number]>) => {
    update({ experience: data.experience.map(e=> e.id===id ? { ...e, ...patch } : e) })
  }
  const removeExp = (id:string) => update({ experience: data.experience.filter(e=>e.id!==id) })

  const addEducation = () => {
    update({ education: [...data.education, { id: Date.now().toString(), degree:'', school:'', location:'', startDate:'', endDate:'', cgpa:'' }] })
  }
  const updateEdu = (id:string, patch: Partial<ResumeData['education'][number]>) => {
    update({ education: data.education.map(e=> e.id===id ? { ...e, ...patch } : e) })
  }
  const removeEdu = (id:string) => update({ education: data.education.filter(e=>e.id!==id) })

  return (
    <div className="space-y-4">
      {/* Template Picker */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-4">
        <p className="text-xs font-bold tracking-widest uppercase text-surface-400 mb-2 flex items-center gap-2"><Sparkles size={12}/> Template</p>
        <div className="grid grid-cols-3 gap-2">
          {RESUME_TEMPLATES.map(t=>(
            <button key={t.id} onClick={()=>update({ template: t.id as ResumeTemplateId })}
              className={`p-3 rounded-xl border text-left transition-all ${data.template===t.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 ring-1 ring-primary-500' : 'border-surface-200 dark:border-night-600 hover:border-surface-300 bg-white dark:bg-night-850'}`}>
              <p className={`text-xs font-bold ${data.template===t.id ? 'text-primary-700 dark:text-primary-300' : 'text-surface-900 dark:text-night-50'}`}>{t.label}</p>
              <p className="text-[10px] text-surface-500 dark:text-night-300 mt-0.5 leading-tight">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <Section title="Personal Information" icon={<User size={16} />} defaultOpen>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Full Name *" value={data.personalInfo.fullName} onChange={v=>updatePersonal({ fullName: v })} placeholder="Aarav Sharma" />
          <Input label="Email *" value={data.personalInfo.email} onChange={v=>updatePersonal({ email: v })} placeholder="aarav@campus.edu" type="email" />
          <Input label="Phone" value={data.personalInfo.phone} onChange={v=>updatePersonal({ phone: v })} placeholder="+91 98765 43210" />
          <Input label="Location" value={data.personalInfo.location} onChange={v=>updatePersonal({ location: v })} placeholder="Delhi, India" />
        </div>
        <Input label="Headline" value={data.personalInfo.headline} onChange={v=>updatePersonal({ headline: v })} placeholder="B.Tech CSE Student | Frontend Developer" />
        <Textarea label="Summary" value={data.personalInfo.summary} onChange={v=>updatePersonal({ summary: v })} placeholder="2-3 lines about you..." rows={3} />

        <div>
          <p className="text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Links</p>
          <div className="space-y-2">
            {data.personalInfo.links.map((l,i)=>(
              <div key={i} className="flex gap-2">
                <input value={l.label} onChange={e=>{
                  const next=[...data.personalInfo.links]; next[i]={...next[i], label:e.target.value}; updatePersonal({ links: next })
                }} placeholder="Label" className="w-28 px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm" />
                <input value={l.url} onChange={e=>{
                  const next=[...data.personalInfo.links]; next[i]={...next[i], url:e.target.value}; updatePersonal({ links: next })
                }} placeholder="https://..." className="flex-1 px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm" />
                <button onClick={()=>{
                  const next=data.personalInfo.links.filter((_,idx)=>idx!==i); updatePersonal({ links: next.length? next: [{label:'LinkedIn',url:''}] })
                }} className="p-2 rounded-xl text-surface-400 hover:text-danger-500 hover:bg-danger-50"><Trash2 size={16}/></button>
              </div>
            ))}
            <button onClick={()=>updatePersonal({ links: [...data.personalInfo.links, {label:'GitHub', url:''}] })}
              className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"><Plus size={12}/> Add link</button>
          </div>
        </div>
      </Section>

      <Section title={`Skills (${data.skills.length})`} icon={<Sparkles size={16} />}>
        <div className="flex gap-2">
          <input value={skillInput} onChange={e=>setSkillInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); addSkill() } }}
            placeholder="Type skill and press Enter" className="flex-1 px-3 py-2.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm" />
          <button onClick={addSkill} className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-medium">Add</button>
        </div>
        {data.skills.length>0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {data.skills.map((s,i)=>(
              <span key={i} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20 text-xs font-medium text-primary-700 dark:text-primary-300">
                {s}
                <button onClick={()=>update({ skills: data.skills.filter((_,idx)=>idx!==i) })} className="p-0.5 hover:bg-primary-100 rounded-full"><X size={12}/></button>
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Projects (${data.projects.length})`} icon={<FolderKanban size={16} />}>
        {data.projects.map(proj=>(
          <div key={proj.id} className="border border-surface-200 dark:border-night-600 rounded-xl p-3 space-y-2 bg-surface-50/50 dark:bg-night-850/50">
            <div className="flex justify-between items-center">
              <p className="text-xs font-bold text-surface-500 tracking-widest uppercase">Project</p>
              <button onClick={()=>removeProject(proj.id)} className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50"><Trash2 size={14}/></button>
            </div>
            <Input label="Title" value={proj.title} onChange={v=>updateProject(proj.id,{title:v})} placeholder="CampusFlow — Campus OS" />
            <Textarea label="Description" value={proj.description} onChange={v=>updateProject(proj.id,{description:v})} placeholder="What did you build?" rows={2} />
            <Input label="Tech (comma separated)" value={proj.tech.join(', ')} onChange={v=>updateProject(proj.id,{tech: v.split(',').map(s=>s.trim()).filter(Boolean)})} placeholder="React, Node.js, PostgreSQL" />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Link" value={proj.link||''} onChange={v=>updateProject(proj.id,{link:v})} placeholder="https://github.com/..." />
              <Input label="Date" value={proj.date||''} onChange={v=>updateProject(proj.id,{date:v})} placeholder="May 2026" />
            </div>
          </div>
        ))}
        <button onClick={addProject} className="w-full py-2.5 rounded-xl border-2 border-dashed border-surface-200 dark:border-night-600 text-sm font-medium text-surface-500 hover:border-primary-300 hover:text-primary-600 flex items-center justify-center gap-2">
          <Plus size={14}/> Add Project
        </button>
      </Section>

      <Section title={`Experience (${data.experience.length})`} icon={<Briefcase size={16} />}>
        {data.experience.map(exp=>(
          <div key={exp.id} className="border border-surface-200 dark:border-night-600 rounded-xl p-3 space-y-2 bg-surface-50/50 dark:bg-night-850/50">
            <div className="flex justify-between items-center">
              <p className="text-xs font-bold text-surface-500 tracking-widest uppercase">Experience</p>
              <button onClick={()=>removeExp(exp.id)} className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50"><Trash2 size={14}/></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input label="Role" value={exp.role} onChange={v=>updateExp(exp.id,{role:v})} placeholder="Frontend Intern" />
              <Input label="Company" value={exp.company} onChange={v=>updateExp(exp.id,{company:v})} placeholder="TechCorp" />
            </div>
            <Input label="Location" value={exp.location||''} onChange={v=>updateExp(exp.id,{location:v})} placeholder="Remote / Delhi" />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Start Date" value={exp.startDate} onChange={v=>updateExp(exp.id,{startDate:v})} placeholder="2025-06" />
              <Input label="End Date" value={exp.endDate} onChange={v=>updateExp(exp.id,{endDate:v})} placeholder="2025-08 or Present" />
            </div>
            <div>
              <p className="text-xs font-medium text-surface-600 dark:text-night-300 mb-1">Bullets</p>
              <div className="space-y-1.5">
                {exp.bullets.map((b, idx)=>(
                  <div key={idx} className="flex gap-2">
                    <input value={b} onChange={e=>{
                      const next=[...exp.bullets]; next[idx]=e.target.value; updateExp(exp.id,{bullets:next})
                    }} placeholder="Achievement or responsibility" className="flex-1 px-3 py-2 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm" />
                    <button onClick={()=>{
                      const next=exp.bullets.filter((_,i)=>i!==idx); updateExp(exp.id,{bullets: next.length? next: ['']})
                    }} className="p-2 text-surface-400 hover:text-danger-500"><Trash2 size={14}/></button>
                  </div>
                ))}
                <button onClick={()=>updateExp(exp.id,{bullets:[...exp.bullets,'']})} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"><Plus size={12}/> Add bullet</button>
              </div>
            </div>
          </div>
        ))}
        <button onClick={addExperience} className="w-full py-2.5 rounded-xl border-2 border-dashed border-surface-200 dark:border-night-600 text-sm font-medium text-surface-500 hover:border-primary-300 hover:text-primary-600 flex items-center justify-center gap-2">
          <Plus size={14}/> Add Experience
        </button>
      </Section>

      <Section title={`Education (${data.education.length})`} icon={<GraduationCap size={16} />}>
        {data.education.map(ed=>(
          <div key={ed.id} className="border border-surface-200 dark:border-night-600 rounded-xl p-3 space-y-2 bg-surface-50/50 dark:bg-night-850/50">
            <div className="flex justify-between items-center">
              <p className="text-xs font-bold text-surface-500 tracking-widest uppercase">Education</p>
              <button onClick={()=>removeEdu(ed.id)} className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50"><Trash2 size={14}/></button>
            </div>
            <Input label="Degree" value={ed.degree} onChange={v=>updateEdu(ed.id,{degree:v})} placeholder="B.Tech Computer Science" />
            <Input label="School" value={ed.school} onChange={v=>updateEdu(ed.id,{school:v})} placeholder="ABC Institute of Technology" />
            <Input label="Location" value={ed.location||''} onChange={v=>updateEdu(ed.id,{location:v})} placeholder="Delhi" />
            <div className="grid grid-cols-3 gap-2">
              <Input label="Start" value={ed.startDate} onChange={v=>updateEdu(ed.id,{startDate:v})} placeholder="2022-08" />
              <Input label="End" value={ed.endDate} onChange={v=>updateEdu(ed.id,{endDate:v})} placeholder="2026-05" />
              <Input label="CGPA" value={ed.cgpa||''} onChange={v=>updateEdu(ed.id,{cgpa:v})} placeholder="8.7" />
            </div>
          </div>
        ))}
        <button onClick={addEducation} className="w-full py-2.5 rounded-xl border-2 border-dashed border-surface-200 dark:border-night-600 text-sm font-medium text-surface-500 hover:border-primary-300 hover:text-primary-600 flex items-center justify-center gap-2">
          <Plus size={14}/> Add Education
        </button>
      </Section>

      <div className="flex items-center gap-2 text-xs text-surface-400">
        <LinkIcon size={12}/> Links like LinkedIn/GitHub show as clickable in Classic/Modern. Minimal puts them in sidebar.
      </div>
    </div>
  )
}
