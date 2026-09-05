import { useState } from 'react'
import type { ResumeData, CustomTemplateConfig, CustomSectionId } from '../../types/resume'
import { DEFAULT_CUSTOM_CONFIG, CUSTOM_FONTS } from '../../types/resume'
import { EyeOff, Eye, ChevronUp, ChevronDown, GripVertical } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Props = {
  data: ResumeData
  onChange?: (next: ResumeData) => void
}

const formatDate = (s: string) => {
  if (!s) return ''
  if (s.toLowerCase() === 'present') return 'Present'
  return s
}

function parseSkillRows(skills: string[]): { label: string; value: string }[] {
  if (!skills || skills.length === 0) return []
  const hasColon = skills.some((s) => String(s).includes(':'))
  if (!hasColon) {
    return [{ label: 'Skills', value: skills.map((s) => String(s).trim()).filter(Boolean).join(', ') }]
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
      if (rows.length > 0) {
        rows[rows.length - 1].value = rows[rows.length - 1].value ? `${rows[rows.length - 1].value}, ${s}` : s
      } else {
        rows.push({ label: 'Other', value: s })
      }
    }
  }
  return rows.filter((r) => r.value)
}

function EditableInline({
  value,
  onChange,
  placeholder,
  multiline,
  className,
  style,
  as = 'span',
}: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  multiline?: boolean
  className?: string
  style?: React.CSSProperties
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'div'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const Tag: any = as
  if (!onChange) {
    return (
      <Tag className={className} style={style}>
        {value || placeholder || ''}
      </Tag>
    )
  }
  if (editing) {
    if (multiline) {
      return (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft !== value) onChange(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(value)
              setEditing(false)
            }
          }}
          placeholder={placeholder}
          rows={3}
          className="w-full px-2 py-1.5 rounded-lg border border-amber-300 bg-amber-50/50 text-inherit focus:outline-none focus:ring-2 focus:ring-amber-400"
          style={style}
        />
      )
    }
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft !== value) onChange(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setEditing(false)
            if (draft !== value) onChange(draft)
          }
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 rounded-lg border border-amber-300 bg-amber-50/50 focus:outline-none focus:ring-2 focus:ring-amber-400"
        style={style}
      />
    )
  }
  return (
    <Tag
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      title="Click to edit"
      className={(className || '') + ' hover:bg-amber-50 hover:ring-1 hover:ring-amber-200 rounded px-0.5 cursor-text transition-colors'}
      style={style}
    >
      {value || <span className="text-[#9ca3af] italic">{placeholder || '—'}</span>}
    </Tag>
  )
}

function SectionChrome({
  id,
  title,
  config,
  onChange,
  children,
  accent,
  showIcons,
  showDividers,
  headingStyle,
  density,
}: {
  id: CustomSectionId
  title: string
  config: CustomTemplateConfig
  onChange?: (next: ResumeData) => void
  children: React.ReactNode
  accent: string
  showIcons: boolean
  showDividers: boolean
  headingStyle: string
  density: string
}) {
  const isHidden = config.hiddenSections.includes(id)
  if (isHidden) return null
  const order = config.sectionOrder
  const idx = order.indexOf(id)
  const canUp = idx > 0
  const canDown = idx < order.length - 1

  const headingTransform =
    headingStyle === 'uppercase' ? 'uppercase tracking-[0.14em]' : headingStyle === 'capitalize' ? 'capitalize' : 'normal-case'
  const headingSize = density === 'compact' ? 'text-[10pt]' : density === 'spacious' ? 'text-[12pt]' : 'text-[11pt]'
  const iconMap: Record<string, string> = {
    summary: '◈',
    skills: '⚡',
    experience: '▣',
    projects: '⬢',
    education: '🎓',
    certifications: '★',
  }

  const handleMove = (dir: -1 | 1) => {
    if (!onChange) return
    const nextOrder = [...order]
    const j = idx + dir
    if (j < 0 || j >= nextOrder.length) return
    ;[nextOrder[idx], nextOrder[j]] = [nextOrder[j], nextOrder[idx]]
    // Need parent to update — we will need data. So we delegate via callback that expects config? Instead we mutate via global? We'll use onChange with patch inside parent.
    // For isolation, we fire a custom event that CustomTemplate listens — simpler: onChange should be closure capturing data.
    // We call onChange with mutated config via a hack: we dispatch via window custom event with detail.
    // But easier: onChange is actually from CustomTemplate's closure capturing data, so moving here will require data.
    // We'll instead expose onOrderChange via props drilling - we pass handler that already knows data.
    // For now, trigger via window event that parent listens.
    window.dispatchEvent(new CustomEvent('custom:reorder', { detail: { id, dir } }))
  }
  const handleToggleHide = () => {
    window.dispatchEvent(new CustomEvent('custom:toggleHide', { detail: { id } }))
  }

  return (
    <section className="group/section relative">
      {/* Hover controls — only when onChange provided (editable) */}
      {onChange && (
        <div className="absolute -top-2 -right-2 hidden group-hover/section:flex items-center gap-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-full shadow-lg p-1 z-10">
          <span className="px-1.5 text-[10px] font-bold tracking-widest uppercase text-surface-400 flex items-center gap-1">
            <GripVertical size={10} /> {title}
          </span>
          <button
            onClick={() => handleMove(-1)}
            disabled={!canUp}
            className="w-6 h-6 rounded-full bg-surface-50 dark:bg-night-700 flex items-center justify-center hover:bg-surface-100 disabled:opacity-30"
            title="Move up"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={() => handleMove(1)}
            disabled={!canDown}
            className="w-6 h-6 rounded-full bg-surface-50 dark:bg-night-700 flex items-center justify-center hover:bg-surface-100 disabled:opacity-30"
            title="Move down"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={handleToggleHide}
            className="w-6 h-6 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center hover:bg-amber-100 text-amber-600"
            title="Hide section"
          >
            <EyeOff size={12} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 mb-1">
        {showIcons && (
          <span
            className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0"
            style={{ background: accent }}
          >
            {iconMap[id] || '•'}
          </span>
        )}
        <h2 className={`font-bold ${headingSize} ${headingTransform} flex-1`} style={{ color: accent }}>
          {title}
        </h2>
        {onChange && (
          <span className="opacity-0 group-hover/section:opacity-100 text-[10px] tracking-widest uppercase text-surface-300">⋮ drag • click text to edit</span>
        )}
      </div>
      {showDividers && <div className="h-[1px] mb-3" style={{ background: accent, opacity: 0.85 }} />}
      {!showDividers && <div className="mb-2" />}
      {children}
    </section>
  )
}

export default function CustomTemplate({ data, onChange }: Props) {
  const cfg: CustomTemplateConfig = data.customConfig || DEFAULT_CUSTOM_CONFIG
  const accent = cfg.accentColor
  const font = CUSTOM_FONTS.find((f) => f.id === cfg.fontFamily)?.family || CUSTOM_FONTS[0].family
  const density = cfg.density
  const pad = density === 'compact' ? 'p-[22px]' : density === 'spacious' ? 'p-[44px]' : 'p-[32px]'
  const bg =
    cfg.background === 'soft'
      ? 'bg-[#f8fafc]'
      : cfg.background === 'gradient'
        ? 'bg-gradient-to-br from-white via-[#f8fafc] to-[#eef2ff]'
        : 'bg-white'
  const border =
    cfg.borderStyle === 'none'
      ? 'border-0'
      : cfg.borderStyle === 'accent'
        ? 'border-2'
        : 'border border-surface-200'
  const borderColor = cfg.borderStyle === 'accent' ? { borderColor: accent } : undefined

  const p = data.personalInfo
  const skillRows = parseSkillRows(data.skills)

  // Handlers to update data via onChange — listeners for reorder/hide via window events
  const updateData = (patch: Partial<ResumeData>) => {
    if (!onChange) return
    onChange({ ...data, ...patch, updatedAt: new Date().toISOString() })
  }
  const updatePersonal = (patch: Partial<ResumeData['personalInfo']>) => {
    updateData({ personalInfo: { ...data.personalInfo, ...patch } })
  }
  const updateConfig = (patch: Partial<CustomTemplateConfig>) => {
    updateData({ customConfig: { ...cfg, ...patch } })
  }

  // Wire reorder/hide events (if onChange exists)
  // Use effect via direct listener in render — imperatively attach once
  // We use a ref flag to avoid duplicate
  if (onChange && typeof window !== 'undefined') {
    // Attach once per render — remove previous to avoid dup
    // @ts-ignore
    if (!(window as any).__customHandlers) {
      // @ts-ignore
      ;(window as any).__customHandlers = true
      window.addEventListener('custom:reorder' as any, ((e: any) => {
        const { id, dir } = e.detail
        const order = cfg.sectionOrder
        const idx = order.indexOf(id)
        const j = idx + dir
        if (idx < 0 || j < 0 || j >= order.length) return
        const next = [...order]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        // need fresh data — read from closure's latest? Use window latest data via event? We'll dispatch via direct update using cfg from closure may be stale; instead we rely on parent handling via custom event listener placed in parent.
        // For now trigger data update via parent's handler that listens same event with fresh state — ResumePreview parent will handle.
      }) as any)
      window.addEventListener('custom:toggleHide' as any, (() => {}) as any)
    }
  }

  // For actual reorder we need to handle inside this component with fresh cfg — we will handle via inline buttons that call updateConfig directly
  // Override SectionChrome handlers to use direct updateConfig
  const handleReorder = (id: CustomSectionId, dir: -1 | 1) => {
    const order = [...cfg.sectionOrder]
    const idx = order.indexOf(id)
    const j = idx + dir
    if (idx < 0 || j < 0 || j >= order.length) return
    ;[order[idx], order[j]] = [order[j], order[idx]]
    updateConfig({ sectionOrder: order })
  }
  const handleToggleHidden = (id: CustomSectionId) => {
    const hidden = cfg.hiddenSections.includes(id)
    updateConfig({ hiddenSections: hidden ? cfg.hiddenSections.filter((x) => x !== id) : [...cfg.hiddenSections, id] })
  }

  const previewSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const handleDragEndPreview = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = cfg.sectionOrder.indexOf(active.id as CustomSectionId)
    const newIndex = cfg.sectionOrder.indexOf(over.id as CustomSectionId)
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = arrayMove(cfg.sectionOrder as CustomSectionId[], oldIndex, newIndex)
    updateConfig({ sectionOrder: newOrder })
  }

  // Dnd for preview sections — persist to customConfig.sectionOrder via updateConfig, mirrored to ResumeForm's sortable
  function SortablePreviewSection({ id, children }: { id: CustomSectionId; children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.85 : 1,
    }
    return (
      <div ref={setNodeRef} style={style} className={isDragging ? 'ring-1 ring-primary-300 rounded-xl bg-white shadow-lg z-10' : 'relative'}>
        {/* Drag handle — always visible for onChange preview; hidden otherwise */}
        {onChange && (
          <button
            {...attributes}
            {...listeners}
            className="absolute -left-3 top-3 w-6 h-6 rounded-full bg-white border border-surface-200 shadow flex items-center justify-center hover:bg-surface-50 cursor-grab active:cursor-grabbing z-10 hidden group-hover/section:flex sm:flex opacity-0 group-hover/section:opacity-100 transition-opacity"
            title="Drag to reorder"
            aria-label={`Drag ${id}`}
          >
            <GripVertical size={12} className="text-surface-400" />
          </button>
        )}
        {children}
      </div>
    )
  }

  // Build section map
  const sectionContent: Record<CustomSectionId, React.ReactNode> = {
    summary: p.summary?.trim() ? (
      <div className="text-[9.5pt] leading-[1.6] whitespace-pre-wrap" style={{ color: '#1f2937' }}>
        <EditableInline
          value={p.summary}
          onChange={onChange ? (v) => updatePersonal({ summary: v }) : undefined}
          placeholder="Write a 2-3 line summary..."
          multiline
          className="block w-full"
        />
      </div>
    ) : onChange ? (
      <button
        onClick={() => updatePersonal({ summary: 'Results-driven student passionate about building user-centric products.' })}
        className="text-xs px-3 py-2 rounded-xl border border-dashed border-surface-200 hover:border-amber-300 text-surface-500 hover:text-amber-600"
      >
        + Add summary
      </button>
    ) : null,
    skills: skillRows.length > 0 ? (
      <div className="space-y-1.5">
        {skillRows.map((row, idx) => (
          <div key={idx} className="flex gap-3 text-[9pt] leading-[1.5]">
            <span className="font-bold shrink-0" style={{ color: accent, minWidth: '120px' }}>
              <EditableInline
                value={row.label}
                onChange={
                  onChange
                    ? (v) => {
                        const next = [...data.skills]
                        // reconstruct skill string for this row
                        const original = data.skills[idx] || `${row.label}: ${row.value}`
                        const colonIdx = original.indexOf(':')
                        const rest = colonIdx > 0 ? original.slice(colonIdx + 1) : row.value
                        next[idx] = `${v}: ${rest.trim()}`
                        updateData({ skills: next })
                      }
                    : undefined
                }
                placeholder="Category"
                className="font-bold"
              />
              :
            </span>
            <span className="flex-1 text-[#1f2937]">
              <EditableInline
                value={row.value}
                onChange={
                  onChange
                    ? (v) => {
                        const next = [...data.skills]
                        const original = data.skills[idx] || `${row.label}: ${row.value}`
                        const colonIdx = original.indexOf(':')
                        const label = colonIdx > 0 ? original.slice(0, colonIdx) : row.label
                        next[idx] = `${label}: ${v}`
                        updateData({ skills: next })
                      }
                    : undefined
                }
                placeholder="Python, React…"
                className="flex-1"
              />
            </span>
          </div>
        ))}
        {onChange && (
          <button
            onClick={() => {
              const next = [...data.skills, 'New Category: item, item']
              updateData({ skills: next })
            }}
            className="text-[11px] px-2.5 py-1 rounded-full border border-surface-200 hover:border-accent hover:text-accent mt-1"
            style={{ borderColor: accent + '40' } as any}
          >
            + Add skill row
          </button>
        )}
      </div>
    ) : onChange ? (
      <button
        onClick={() => updateData({ skills: ['Languages: JavaScript, TypeScript, Python'] })}
        className="text-xs px-3 py-2 rounded-xl border border-dashed border-surface-200 hover:border-amber-300 text-surface-500"
      >
        + Add skills
      </button>
    ) : (
      <p className="text-[9pt] text-[#9ca3af] italic">No skills yet</p>
    ),
    experience:
      data.experience.length > 0 ? (
        <div className="space-y-4">
          {data.experience.map((exp) => (
            <div
              key={exp.id}
              className="group/item relative rounded-xl p-3 -mx-3 hover:bg-surface-50/60 dark:hover:bg-night-800/40 border border-transparent hover:border-surface-100"
            >
              {onChange && (
                <button
                  onClick={() => updateData({ experience: data.experience.filter((e) => e.id !== exp.id) })}
                  className="absolute top-2 right-2 opacity-0 group-hover/item:opacity-100 w-7 h-7 rounded-full bg-white border border-surface-200 flex items-center justify-center hover:bg-red-50 hover:text-red-600 hover:border-red-200 shadow-sm"
                  title="Remove experience"
                >
                  <EyeOff size={12} />
                </button>
              )}
              <div className="flex justify-between gap-3 items-start">
                <h3 className="font-bold text-[10pt] leading-tight flex-1" style={{ color: '#111827' }}>
                  <EditableInline
                    value={exp.role}
                    onChange={onChange ? (v) => updateData({ experience: data.experience.map((e) => (e.id === exp.id ? { ...e, role: v } : e)) }) : undefined}
                    placeholder="Role"
                    className="font-bold"
                  />{' '}
                  <span className="font-normal italic text-[#4b5563]">
                    —{' '}
                    <EditableInline
                      value={exp.company}
                      onChange={onChange ? (v) => updateData({ experience: data.experience.map((e) => (e.id === exp.id ? { ...e, company: v } : e)) }) : undefined}
                      placeholder="Company"
                    />
                    {exp.location ? ' · ' : ''}
                    <EditableInline
                      value={exp.location || ''}
                      onChange={onChange ? (v) => updateData({ experience: data.experience.map((e) => (e.id === exp.id ? { ...e, location: v } : e)) }) : undefined}
                      placeholder="Location"
                    />
                  </span>
                </h3>
                <span className="text-[8pt] shrink-0 font-medium px-2 py-1 rounded-full bg-surface-50 border border-surface-100" style={{ color: accent }}>
                  <EditableInline
                    value={`${formatDate(exp.startDate)} – ${formatDate(exp.endDate)}`}
                    onChange={
                      onChange
                        ? (v) => {
                            const parts = v.split('–').map((s) => s.trim())
                            updateData({
                              experience: data.experience.map((e) => (e.id === exp.id ? { ...e, startDate: parts[0] || e.startDate, endDate: parts[1] || e.endDate } : e)),
                            })
                          }
                        : undefined
                    }
                    placeholder="2024-06 – Present"
                  />
                </span>
              </div>
              <div className="mt-2 space-y-1.5 pl-4 border-l-2" style={{ borderColor: accent + '22' }}>
                {exp.bullets.filter(Boolean).map((b, i) => (
                  <div key={i} className="flex gap-2 group/bullet">
                    <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
                    <span className="flex-1 text-[9pt] leading-[1.5] text-[#1f2937]">
                      <EditableInline
                        value={b}
                        onChange={
                          onChange
                            ? (v) => {
                                const next = [...exp.bullets]
                                next[i] = v
                                updateData({ experience: data.experience.map((e) => (e.id === exp.id ? { ...e, bullets: next } : e)) })
                              }
                            : undefined
                        }
                        placeholder="Achievement with metric"
                        multiline
                      />
                    </span>
                    {onChange && (
                      <button
                        onClick={() => {
                          const next = exp.bullets.filter((_, idx) => idx !== i)
                          updateData({ experience: data.experience.map((e) => (e.id === exp.id ? { ...e, bullets: next.length ? next : [''] } : e)) })
                        }}
                        className="opacity-0 group-hover/bullet:opacity-100 text-surface-400 hover:text-red-500 px-1"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {onChange && (
                  <button
                    onClick={() => {
                      const next = [...exp.bullets, 'Built feature that improved metric by X%']
                      updateData({ experience: data.experience.map((e) => (e.id === exp.id ? { ...e, bullets: next } : e)) })
                    }}
                    className="text-[11px] text-surface-500 hover:text-accent mt-1"
                    style={{ color: accent } as any}
                  >
                    + Add bullet
                  </button>
                )}
              </div>
            </div>
          ))}
          {onChange && (
            <button
              onClick={() =>
                updateData({
                  experience: [
                    ...data.experience,
                    { id: Date.now().toString(), role: 'New Role', company: 'Company', location: '', startDate: '2024-01', endDate: 'Present', bullets: ['Achievement…'] },
                  ],
                })
              }
              className="w-full py-2 rounded-xl border-2 border-dashed border-surface-200 hover:border-accent/40 text-xs font-medium text-surface-500 hover:text-accent"
            >
              + Add Experience
            </button>
          )}
        </div>
      ) : onChange ? (
        <button
          onClick={() =>
            updateData({
              experience: [{ id: Date.now().toString(), role: 'Frontend Intern', company: 'TechCorp', location: 'Remote', startDate: '2024-06', endDate: '2024-08', bullets: ['Built …'] }],
            })
          }
          className="text-xs px-3 py-2 rounded-xl border border-dashed border-surface-200 hover:border-amber-300 text-surface-500"
        >
          + Add experience
        </button>
      ) : (
        <p className="text-[9pt] text-[#9ca3af] italic">No experience yet</p>
      ),
    projects:
      data.projects.length > 0 ? (
        <div className="grid gap-3">
          {data.projects.map((proj) => (
            <div key={proj.id} className="group/item relative rounded-xl border p-3 hover:shadow-sm transition-shadow" style={{ borderColor: accent + '18', background: 'white' }}>
              {onChange && (
                <button
                  onClick={() => updateData({ projects: data.projects.filter((p) => p.id !== proj.id) })}
                  className="absolute top-2 right-2 opacity-0 group-hover/item:opacity-100 w-7 h-7 rounded-full bg-white border border-surface-200 flex items-center justify-center hover:bg-red-50 hover:text-red-600 shadow-sm"
                >
                  ×
                </button>
              )}
              <div className="flex justify-between gap-2 items-start">
                <h3 className="font-bold text-[10pt] text-[#111827] flex-1">
                  <EditableInline
                    value={proj.title}
                    onChange={onChange ? (v) => updateData({ projects: data.projects.map((p) => (p.id === proj.id ? { ...p, title: v } : p)) }) : undefined}
                    placeholder="Project title"
                  />
                </h3>
                <span className="text-[7.5pt] px-2 py-1 rounded-full border font-medium shrink-0" style={{ borderColor: accent + '30', color: accent, background: accent + '0D' }}>
                  <EditableInline
                    value={proj.date || ''}
                    onChange={onChange ? (v) => updateData({ projects: data.projects.map((p) => (p.id === proj.id ? { ...p, date: v } : p)) }) : undefined}
                    placeholder="2024"
                  />
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {proj.tech.map((t, i) => (
                  <span
                    key={i}
                    className="text-[7pt] px-2 py-1 rounded-full font-semibold border bg-white"
                    style={{ borderColor: accent + '30', color: accent, background: accent + '0F' }}
                  >
                    {t}
                  </span>
                ))}
                {onChange && (
                  <button
                    onClick={() => {
                      const v = window.prompt('Tech (comma separated)', proj.tech.join(', '))
                      if (v !== null) updateData({ projects: data.projects.map((p) => (p.id === proj.id ? { ...p, tech: v.split(',').map((s) => s.trim()).filter(Boolean) } : p)) })
                    }}
                    className="text-[7pt] px-2 py-1 rounded-full border border-dashed border-surface-200 hover:border-accent/40"
                  >
                    + tech
                  </button>
                )}
              </div>
              <p className="text-[9pt] leading-[1.5] text-[#1f2937] mt-2">
                <EditableInline
                  value={proj.description}
                  onChange={onChange ? (v) => updateData({ projects: data.projects.map((p) => (p.id === proj.id ? { ...p, description: v } : p)) }) : undefined}
                  placeholder="What did you build?"
                  multiline
                />
              </p>
              <div className="mt-1.5">
                <EditableInline
                  value={proj.link || ''}
                  onChange={onChange ? (v) => updateData({ projects: data.projects.map((p) => (p.id === proj.id ? { ...p, link: v } : p)) }) : undefined}
                  placeholder="https://github.com/…"
                  className="text-[8pt] underline break-all"
                  style={{ color: accent } as any}
                />
              </div>
            </div>
          ))}
          {onChange && (
            <button
              onClick={() => updateData({ projects: [...data.projects, { id: Date.now().toString(), title: 'New Project', description: '', tech: ['React'], link: '', date: '2024' }] })}
              className="w-full py-2 rounded-xl border-2 border-dashed border-surface-200 hover:border-accent/40 text-xs font-medium text-surface-500 hover:text-accent"
            >
              + Add Project
            </button>
          )}
        </div>
      ) : onChange ? (
        <button
          onClick={() => updateData({ projects: [{ id: Date.now().toString(), title: 'CampusFlow', description: 'Built …', tech: ['React'], link: '', date: '2024' }] })}
          className="text-xs px-3 py-2 rounded-xl border border-dashed border-surface-200 hover:border-amber-300 text-surface-500"
        >
          + Add project
        </button>
      ) : (
        <p className="text-[9pt] text-[#9ca3af] italic">No projects yet</p>
      ),
    education:
      data.education.length > 0 ? (
        <div className="space-y-3">
          {data.education.map((ed) => (
            <div
              key={ed.id}
              className="group/item relative flex justify-between gap-3 rounded-xl p-3 -mx-3 hover:bg-surface-50/60 border border-transparent hover:border-surface-100"
            >
              {onChange && (
                <button
                  onClick={() => updateData({ education: data.education.filter((e) => e.id !== ed.id) })}
                  className="absolute top-2 right-2 opacity-0 group-hover/item:opacity-100 w-6 h-6 rounded-full bg-white border flex items-center justify-center hover:bg-red-50 hover:text-red-600"
                >
                  ×
                </button>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-[10pt] text-[#111827]">
                  <EditableInline
                    value={ed.degree}
                    onChange={onChange ? (v) => updateData({ education: data.education.map((e) => (e.id === ed.id ? { ...e, degree: v } : e)) }) : undefined}
                    placeholder="B.Tech CSE"
                  />
                </h3>
                <p className="text-[9pt] text-[#374151]">
                  <EditableInline
                    value={ed.school}
                    onChange={onChange ? (v) => updateData({ education: data.education.map((e) => (e.id === ed.id ? { ...e, school: v } : e)) }) : undefined}
                    placeholder="Institute"
                  />
                  {ed.location ? ' · ' : ''}
                  <EditableInline
                    value={ed.location || ''}
                    onChange={onChange ? (v) => updateData({ education: data.education.map((e) => (e.id === ed.id ? { ...e, location: v } : e)) }) : undefined}
                    placeholder="City"
                  />
                </p>
                {ed.cgpa && <p className="text-[8pt] text-[#6b7280]">CGPA: {ed.cgpa}</p>}
              </div>
              <span className="text-[8pt] shrink-0 font-medium px-2 py-1 rounded-full bg-surface-50 border border-surface-100 h-fit" style={{ color: accent }}>
                <EditableInline
                  value={`${formatDate(ed.startDate)} – ${formatDate(ed.endDate)}`}
                  onChange={
                    onChange
                      ? (v) => {
                          const parts = v.split('–').map((s) => s.trim())
                          updateData({ education: data.education.map((e) => (e.id === ed.id ? { ...e, startDate: parts[0] || e.startDate, endDate: parts[1] || e.endDate } : e)) })
                        }
                      : undefined
                  }
                  placeholder="2022 – 2026"
                />
                {ed.cgpa ? ` · ${ed.cgpa}` : ''}
              </span>
            </div>
          ))}
          {onChange && (
            <button
              onClick={() =>
                updateData({
                  education: [...data.education, { id: Date.now().toString(), degree: 'B.Tech', school: 'ABC Institute', location: '', startDate: '2022', endDate: '2026', cgpa: '8.5' }],
                })
              }
              className="w-full py-2 rounded-xl border-2 border-dashed border-surface-200 hover:border-accent/40 text-xs font-medium text-surface-500 hover:text-accent"
            >
              + Add Education
            </button>
          )}
        </div>
      ) : onChange ? (
        <button
          onClick={() =>
            updateData({
              education: [{ id: Date.now().toString(), degree: 'B.Tech CSE', school: 'ABC Institute', location: 'Delhi', startDate: '2022', endDate: '2026', cgpa: '8.7' }],
            })
          }
          className="text-xs px-3 py-2 rounded-xl border border-dashed border-surface-200 hover:border-amber-300 text-surface-500"
        >
          + Add education
        </button>
      ) : (
        <p className="text-[9pt] text-[#9ca3af] italic">No education yet</p>
      ),
    certifications:
      data.certifications && data.certifications.length > 0 ? (
        <div className="space-y-2.5">
          {data.certifications.map((c) => (
            <div key={c.id} className="group/item relative flex justify-between gap-3 rounded-xl p-3 -mx-3 hover:bg-surface-50/60 border border-transparent hover:border-surface-100">
              {onChange && (
                <button
                  onClick={() => updateData({ certifications: (data.certifications || []).filter((x) => x.id !== c.id) })}
                  className="absolute top-2 right-2 opacity-0 group-hover/item:opacity-100 w-6 h-6 rounded-full bg-white border flex items-center justify-center hover:bg-red-50 hover:text-red-600"
                >
                  ×
                </button>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-[9.5pt] text-[#111827]">
                  <EditableInline
                    value={c.name}
                    onChange={onChange ? (v) => updateData({ certifications: (data.certifications || []).map((x) => (x.id === c.id ? { ...x, name: v } : x)) }) : undefined}
                    placeholder="AWS Certified"
                  />
                  {c.issuer ? (
                    <>
                      {' '}
                      <span className="font-normal italic text-[#6b7280]">
                        —{' '}
                        <EditableInline
                          value={c.issuer}
                          onChange={onChange ? (v) => updateData({ certifications: (data.certifications || []).map((x) => (x.id === c.id ? { ...x, issuer: v } : x)) }) : undefined}
                          placeholder="Issuer"
                        />
                      </span>
                    </>
                  ) : null}
                </h3>
                {c.url && (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[8pt] underline break-all" style={{ color: accent }}>
                    {c.url}
                  </a>
                )}
                {onChange && !c.url && (
                  <div className="mt-1">
                    <EditableInline
                      value={c.url || ''}
                      onChange={(v: string) => updateData({ certifications: (data.certifications || []).map((x) => (x.id === c.id ? { ...x, url: v } : x)) })}
                      placeholder="Verify URL"
                      className="text-[8pt] underline"
                      style={{ color: accent } as any}
                    />
                  </div>
                )}
              </div>
              <span className="text-[8pt] shrink-0 font-medium px-2 py-1 rounded-full bg-surface-50 border border-surface-100 h-fit" style={{ color: accent }}>
                <EditableInline
                  value={c.date || ''}
                  onChange={onChange ? (v) => updateData({ certifications: (data.certifications || []).map((x) => (x.id === c.id ? { ...x, date: v } : x)) }) : undefined}
                  placeholder="2024"
                />
              </span>
            </div>
          ))}
          {onChange && (
            <button
              onClick={() =>
                updateData({ certifications: [...(data.certifications || []), { id: Date.now().toString(), name: 'New Cert', issuer: '', date: '2024', url: '' }] })
              }
              className="w-full py-2 rounded-xl border-2 border-dashed border-surface-200 hover:border-accent/40 text-xs font-medium text-surface-500 hover:text-accent"
            >
              + Add Certification
            </button>
          )}
        </div>
      ) : onChange ? (
        <button
          onClick={() => updateData({ certifications: [{ id: Date.now().toString(), name: 'Certificate', issuer: 'Issuer', date: '2024', url: '' }] })}
          className="text-xs px-3 py-2 rounded-xl border border-dashed border-surface-200 hover:border-amber-300 text-surface-500"
        >
          + Add certification
        </button>
      ) : (
        <p className="text-[9pt] text-[#9ca3af] italic">No certifications yet</p>
      ),
  }

  const hiddenSet = new Set(cfg.hiddenSections)
  const orderedIds = cfg.sectionOrder.filter((id) => !hiddenSet.has(id))

  // Compute header background based on config
  const headerBg = cfg.background === 'soft' ? 'bg-[#f8fafc]' : cfg.background === 'gradient' ? 'bg-gradient-to-br from-white to-[#eef2ff]' : 'bg-white'

  return (
    <div
      className={`${bg} ${pad} ${border} rounded-xl overflow-hidden`}
      style={{ fontFamily: font, color: '#111827', borderColor: borderColor?.borderColor } as any}
    >
      {/* Header — fully editable inline */}
      <div className={`-mx-[1px] -mt-[1px] px-4 py-5 rounded-xl mb-4 ${headerBg} border`} style={{ borderColor: accent + '14' }}>
        <div className="flex justify-between items-start gap-4">
          <h1 className="font-extrabold tracking-tight leading-none flex-1" style={{ fontSize: density === 'compact' ? '20pt' : density === 'spacious' ? '26pt' : '24pt', color: '#0f172a' }}>
            <EditableInline
              value={p.fullName || ''}
              onChange={onChange ? (v) => updatePersonal({ fullName: v }) : undefined}
              placeholder="Your Name"
              as="span"
              className="font-extrabold"
            />
          </h1>
          <div className="shrink-0 text-right">
            <div className="text-[9pt] font-medium" style={{ color: accent }}>
              <EditableInline
                value={p.location || ''}
                onChange={onChange ? (v) => updatePersonal({ location: v }) : undefined}
                placeholder="City, Country"
              />
            </div>
            <div className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[8pt] font-bold tracking-widest uppercase border" style={{ background: accent + '14', color: accent, borderColor: accent + '22' }}>
              <EditableInline
                value={p.headline || ''}
                onChange={onChange ? (v) => updatePersonal({ headline: v }) : undefined}
                placeholder="FULL STACK DEVELOPER"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3 text-[8.5pt]">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-surface-200 hover:border-surface-300">
            ✉{' '}
            <EditableInline
              value={p.email || ''}
              onChange={onChange ? (v) => updatePersonal({ email: v }) : undefined}
              placeholder="email@domain.com"
              className="text-[8.5pt]"
            />
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-surface-200">
            ☎{' '}
            <EditableInline
              value={p.phone || ''}
              onChange={onChange ? (v) => updatePersonal({ phone: v }) : undefined}
              placeholder="+91 9xxxxxxxxx"
            />
          </span>
          {p.links.map((l, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border hover:border-surface-300" style={{ borderColor: accent + '22' }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: accent }}>
                {l.label.charAt(0).toUpperCase()}
              </span>
              <EditableInline
                value={l.label}
                onChange={
                  onChange
                    ? (v) => {
                        const next = [...p.links]
                        next[i] = { ...next[i], label: v }
                        updatePersonal({ links: next })
                      }
                    : undefined
                }
                placeholder="Label"
                className="font-semibold"
              />
              <span className="text-surface-300">·</span>
              <EditableInline
                value={l.url}
                onChange={
                  onChange
                    ? (v) => {
                        const next = [...p.links]
                        next[i] = { ...next[i], url: v }
                        updatePersonal({ links: next })
                      }
                    : undefined
                }
                placeholder="https://…"
                className="text-[8pt] max-w-[150px] truncate"
                style={{ color: accent } as any}
              />
              {onChange && p.links.length > 1 && (
                <button
                  onClick={() => updatePersonal({ links: p.links.filter((_, idx) => idx !== i) })}
                  className="ml-1 w-5 h-5 rounded-full bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 text-[10px]"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {onChange && (
            <button
              onClick={() => updatePersonal({ links: [...p.links, { label: 'New Link', url: 'https://' }] })}
              className="px-2.5 py-1 rounded-full border-2 border-dashed border-surface-200 hover:border-accent/40 text-[8pt] font-medium text-surface-500 hover:text-accent bg-white"
            >
              + Link
            </button>
          )}
        </div>

        {onChange && (
          <p className="mt-3 text-[10px] tracking-wide text-surface-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: accent }} /> Click any text to edit • Hover sections to reorder/hide • Use left panel “Custom Studio” to change colors, fonts, density
          </p>
        )}
      </div>

      {/* Sections in custom order — sortable via @dnd-kit */}
      <DndContext sensors={previewSensors} collisionDetection={closestCenter} onDragEnd={handleDragEndPreview}>
        <SortableContext items={orderedIds as string[]} strategy={verticalListSortingStrategy}>
              <div className={`space-y-6 ${density === 'compact' ? 'space-y-4' : density === 'spacious' ? 'space-y-8' : 'space-y-6'}`}>
                {orderedIds.map((id) => {
          const titleMap: Record<CustomSectionId, string> = {
            summary: 'Summary',
            skills: 'Technical Skills',
            experience: 'Experience',
            projects: 'Projects',
            education: 'Education',
            certifications: 'Certifications',
          }
          return (
            <SortablePreviewSection key={id} id={id}>
              {(() => {
                const chromeProps = {
                  id,
                  title: titleMap[id],
                  config: cfg,
                  onChange,
                  accent,
                  showIcons: cfg.showIcons,
                  showDividers: cfg.showDividers,
                  headingStyle: cfg.headingStyle,
                  density: cfg.density,
                }
                // For reorder we use direct handlers instead of window events
                return (
                  <section className="group/section relative">
                    {onChange && (
                      <div className="absolute -top-2 -right-2 hidden group-hover/section:flex items-center gap-1 bg-white border border-surface-200 rounded-full shadow-lg p-1 z-10">
                        <span className="px-1.5 text-[10px] font-bold tracking-widest uppercase text-surface-400 flex items-center gap-1">
                          <GripVertical size={10} /> {titleMap[id]}
                        </span>
                        <button
                          onClick={() => handleReorder(id, -1)}
                          disabled={cfg.sectionOrder.indexOf(id) === 0}
                          className="w-6 h-6 rounded-full bg-surface-50 flex items-center justify-center hover:bg-surface-100 disabled:opacity-30"
                          title="Move up"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          onClick={() => handleReorder(id, 1)}
                          disabled={cfg.sectionOrder.indexOf(id) === cfg.sectionOrder.length - 1}
                          className="w-6 h-6 rounded-full bg-surface-50 flex items-center justify-center hover:bg-surface-100 disabled:opacity-30"
                          title="Move down"
                        >
                          <ChevronDown size={12} />
                        </button>
                        <button
                          onClick={() => handleToggleHidden(id)}
                          className="w-6 h-6 rounded-full bg-amber-50 flex items-center justify-center hover:bg-amber-100 text-amber-600"
                          title="Hide section"
                        >
                          <EyeOff size={12} />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      {cfg.showIcons && (
                        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ background: accent }}>
                          {{
                            summary: '◈',
                            skills: '⚡',
                            experience: '▣',
                            projects: '⬢',
                            education: '🎓',
                            certifications: '★',
                          }[id] || '•'}
                        </span>
                      )}
                      <h2
                        className={`font-bold ${density === 'compact' ? 'text-[10pt]' : density === 'spacious' ? 'text-[12pt]' : 'text-[11pt]'} ${
                          cfg.headingStyle === 'uppercase' ? 'uppercase tracking-[0.14em]' : cfg.headingStyle === 'capitalize' ? 'capitalize' : 'normal-case'
                        } flex-1`}
                        style={{ color: accent }}
                      >
                        {titleMap[id]}
                      </h2>
                      {onChange && <span className="opacity-0 group-hover/section:opacity-100 text-[10px] tracking-widest uppercase text-surface-300">⋮ drag • click text to edit</span>}
                    </div>
                    {cfg.showDividers && <div className="h-[1px] mb-3" style={{ background: accent, opacity: 0.85 }} />}
                    {!cfg.showDividers && <div className="mb-2" />}
                    {sectionContent[id]}
                  </section>
                )
              })()}
            </SortablePreviewSection>
          )
        })}
              </div>
            </SortableContext>
          </DndContext>

      {/* Hidden sections bar */}
      {onChange && cfg.hiddenSections.length > 0 && (
        <div className="mt-6 p-3 rounded-xl bg-amber-50 border border-amber-200 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold tracking-widest uppercase text-amber-700 flex items-center gap-1">
            <EyeOff size={12} /> Hidden
          </span>
          {cfg.hiddenSections.map((id) => (
            <button
              key={id}
              onClick={() => handleToggleHidden(id)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-amber-200 text-xs font-medium text-amber-700 hover:bg-amber-100"
            >
              <Eye size={12} /> {id}
            </button>
          ))}
          <button onClick={() => updateConfig({ hiddenSections: [] })} className="text-xs font-bold text-amber-700 hover:underline ml-1">
            Show all
          </button>
        </div>
      )}

      <p className="text-center mt-8 tracking-wide" style={{ fontSize: '7pt', color: '#9ca3af' }}>
        Custom — fully editable • {cfg.fontFamily} • {cfg.density} • click any text to edit • drag to reorder
      </p>
    </div>
  )
}
