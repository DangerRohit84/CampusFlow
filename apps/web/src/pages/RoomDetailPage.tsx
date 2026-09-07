import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { getSocket } from '../lib/socket'
import { Loader2, Upload, DoorOpen, ArrowLeft, Users, FileText, KeyRound, Copy, Check, BookOpen, MessageSquare, Sparkles, Shield, Layers, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'
import RoomChatPanel from '../components/room/RoomChatPanel'
import RoomChatSettingsModal from '../components/room/RoomChatSettingsModal'
import RoomResourcesPanel, { formatFileSize } from '../components/room/RoomResourcesPanel'
import RoomMembersPanel from '../components/room/RoomMembersPanel'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'
import CenteredLoader from '../components/ui/CenteredLoader'
import type { RoomTabKey } from '../components/room/RoomTabs'
import RoomTabs from '../components/room/RoomTabs'
import clsx from 'clsx'

export default function RoomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [room, setRoom] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<RoomTabKey>('chat')
  const [members, setMembers] = useState<any[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [resources, setResources] = useState<Record<string, any[]>>({})
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [unreadChat, setUnreadChat] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showChatSettings, setShowChatSettings] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState('lecture')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  useEffect(() => {
    if (id) {
      loadRoom()
      // clear sidebar badge when opening room
      roomAPI.markRead(id).then(() => window.dispatchEvent(new CustomEvent('room:read', { detail: { roomId: id } }))).catch(() => {})
    }
  }, [id])

  useEffect(() => {
    if (id && activeTab === 'members') loadMembers()
    if (id && activeTab === 'resources') loadResources()
  }, [id, activeTab])

  // Chat badge dot: flag incoming messages that arrive while another tab is open
  useEffect(() => {
    const socket = getSocket()
    if (!socket || !id) return
    const handler = (message: any) => {
      if (message.roomId !== id) return
      if (message.senderId === user?.id) return
      if (activeTabRef.current !== 'chat') setUnreadChat(true)
    }
    socket.on('room:message:new', handler)
    return () => { socket.off('room:message:new', handler) }
  }, [id, user?.id])

  const handleTabChange = (tab: RoomTabKey) => {
    setActiveTab(tab)
    if (tab === 'chat') {
      setUnreadChat(false)
      if (id) roomAPI.markRead(id).then(() => window.dispatchEvent(new CustomEvent('room:read', { detail: { roomId: id } }))).catch(() => {})
    }
  }

  const loadRoom = async () => {
    try {
      const data = await roomAPI.getOne(id!)
      setRoom(data)
    } catch (err) {
      toast.error('Failed to load room')
      navigate('/rooms')
    } finally {
      setLoading(false)
    }
  }

  const loadMembers = async () => {
    setMembersLoading(true)
    try {
      const data = await roomAPI.getMembers(id!)
      setMembers(data)
    } catch (err) {
      console.error('Failed to load members', err)
    } finally {
      setMembersLoading(false)
    }
  }

  const loadResources = async () => {
    setResourcesLoading(true)
    try {
      const data = await roomAPI.getResources(id!)
      // Backend returns grouped: { lecture: [...], assignment: [...], ... }
      const grouped: Record<string, any[]> = { lecture: [], assignment: [], reference: [], other: [] }
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        Object.entries(data).forEach(([cat, items]) => {
          if (grouped[cat]) grouped[cat] = items as any[]
          else grouped.other.push(...(items as any[]))
        })
      } else if (Array.isArray(data)) {
        data.forEach((r: any) => {
          const cat = r.category || 'other'
          if (grouped[cat]) grouped[cat].push(r)
          else grouped.other.push(r)
        })
      }
      setResources(grouped)
    } catch (err) {
      console.error('Failed to load resources', err)
    } finally {
      setResourcesLoading(false)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error('Please select a file')
      return
    }
    if (!uploadTitle.trim()) {
      toast.error('Please enter a title')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('title', uploadTitle.trim())
      formData.append('category', uploadCategory)

      await roomAPI.uploadResource(id!, formData)
      toast.success('Resource uploaded!')
      setShowUpload(false)
      setUploadTitle('')
      setUploadCategory('lecture')
      setUploadFile(null)
      loadResources()
    } catch (err) {
      toast.error('Failed to upload resource')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteResource = async (resourceId: string) => {
    setDeleting(resourceId)
    try {
      await roomAPI.deleteResource(id!, resourceId)
      toast.success('Resource deleted!')
      loadResources()
    } catch (err) {
      toast.error('Failed to delete resource')
    } finally {
      setDeleting(null)
    }
  }

  const handleToggleCR = async (studentId: string, isCurrentlyCR: boolean) => {
    try {
      if (isCurrentlyCR) {
        await roomAPI.removeCR(id!, studentId)
        toast.success('CR removed')
      } else {
        await roomAPI.makeCR(id!, studentId)
        toast.success('Student is now CR')
      }
      loadMembers()
    } catch (err) {
      toast.error('Failed to update CR status')
    }
  }

  const totalResources = Object.values(resources).flat().length

  // Derived from room state so optimistic settings updates reflect instantly
  const canManageSettings = !!room?.canManageSettings
  const effectiveCanChat = room
    ? canManageSettings ||
      room.chatMode === 'EVERYONE' ||
      (room.chatMode === 'SELECTED' && (room.allowedMembers || []).some((m: any) => m.id === user?.id))
    : false

  const openChatSettings = async () => {
    if (members.length === 0) await loadMembers()
    setShowChatSettings(true)
  }

  const applyChatSettings = (settings: { chatMode: string; allowedMembers: any[] }) => {
    setRoom((prev: any) => (prev ? { ...prev, chatMode: settings.chatMode, allowedMembers: settings.allowedMembers } : prev))
  }

  const revertChatSettings = () => {
    loadRoom()
  }

  const copyJoinCode = () => {
    if (!room?.joinCode) return
    navigator.clipboard.writeText(room.joinCode)
    toast.success('Join code copied!')
    setCopied(true)
    setTimeout(()=> setCopied(false), 2000)
  }

  if (loading) {
    return <CenteredLoader text="Loading room..." />
  }

  if (!room) return null

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Hero — Spotify mesh, glass stats ─── */}
      <PremiumHero
        icon={<DoorOpen size={18} />}
        eyebrow="Rooms · Channel"
        title={<span className="text-balance">{room.name}</span>}
        subtitle={room.description ? room.description.slice(0, 160) : 'Channel, members, resources and live chat — everything for this room in one bento workspace.'}
        actions={
          <>
            <button onClick={() => navigate('/rooms')} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-white text-black text-[13px] font-black hover:bg-zinc-100 transition-colors shadow-lg">
              <ArrowLeft size={14}/> Back to Rooms
            </button>
            <button onClick={copyJoinCode} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-primary-500 text-black text-[13px] font-black hover:bg-[#1ed760] shadow-[0_8px_24px_rgba(30,215,96,0.35)] transition-colors">
              <KeyRound size={14}/> {room.joinCode || '—'} {copied ? <Check size={14}/> : <Copy size={14}/>}
            </button>
            {canManageSettings && (
              <button onClick={openChatSettings} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-[13px] font-bold hover:bg-white/15 transition-colors">
                <Shield size={14}/> Settings
              </button>
            )}
          </>
        }
        stats={
          <GlassPanel className="p-4">
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-white/60">Room Pulse</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white p-3 dark:bg-[#121212] border border-white/10">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/50 dark:text-white/60">Members</p>
                <p className="mt-1 font-display text-[22px] font-[800] leading-none text-black dark:text-white">{members.length || room._count?.members || 0}</p>
                <p className="mt-1 text-[11px] font-semibold text-black/60 dark:text-white/60 flex items-center gap-1"><Users size={11}/> Joined</p>
              </div>
              <div className="rounded-2xl bg-primary-500 p-3 text-black">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/60">Resources</p>
                <p className="mt-1 font-display text-[22px] font-[800] leading-none">{totalResources}</p>
                <p className="mt-1 text-[11px] font-bold text-black/70 flex items-center gap-1"><FileText size={11}/> Files</p>
              </div>
              <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/10 p-3 col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white/70 flex items-center gap-1.5"><KeyRound size={11} className="text-primary-400"/> Join Code</span>
                  <span className="text-[11px] font-black tracking-widest bg-white text-black px-2 py-1 rounded-full">{room.joinCode}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-white/60">
                  <span className="inline-flex items-center gap-1"><MessageSquare size={11}/> Chat {room.chatMode || 'EVERYONE'}</span>
                  {unreadChat && <span className="w-2 h-2 rounded-full bg-[#ff4b5c] animate-pulse"/>}
                </div>
                {room.teacher?.name && <p className="mt-1 text-[11px] font-medium text-white/50">By {room.teacher.name}</p>}
              </div>
            </div>
          </GlassPanel>
        }
      />
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />

      {/* Premium Bento — Room meta */}
      <motion.div initial="hidden" animate="show" variants={{ hidden:{}, show:{ transition:{ staggerChildren:0.06, delayChildren:0.1 } } }} className="space-y-6">
        <BentoGrid>
          <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ duration:0.4, ease:[0.22,1,0.36,1] as any } } }} className="col-span-12 lg:col-span-8">
            <SectionCard title={room.name} subtitle={`${members.length || room._count?.members || 0} members · ${totalResources} resources${room.teacher?.name ? ` · ${room.teacher.name}` : ''}`} icon={<BookOpen size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500">
              <p className="text-sm leading-relaxed text-surface-600 dark:text-night-300">{room.description || 'No description — add context for members.'}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-500 text-black text-xs font-black"><Users size={12}/> {members.length || room._count?.members || 0} members</span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-900 dark:bg-white text-white dark:text-black text-xs font-bold"><FileText size={12}/> {totalResources} resources</span>
                {room.joinCode && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-50 dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] text-xs font-mono font-bold tracking-wider"><KeyRound size={12} className="text-primary-500"/>{room.joinCode}</span>}
                {room.chatMode && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-50 dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] text-xs font-bold"><MessageSquare size={12}/> {room.chatMode}</span>}
              </div>
            </SectionCard>
          </motion.div>
          <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ delay:0.08, duration:0.4 } } }} className="col-span-12 lg:col-span-4">
            <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden h-full hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] transition-shadow">
              <div className="h-1.5 bg-gradient-to-r from-primary-500 to-emerald-500" />
              <div className="p-5 sm:p-6">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center"><Zap size={16}/></span>
                  <h3 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">Quick Actions</h3>
                </div>
                <div className="space-y-2.5">
                  <button onClick={()=> handleTabChange('chat')} className={clsx('w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all', activeTab==='chat' ? 'bg-primary-500 border-primary-500 text-black' : 'bg-surface-50 dark:bg-[#0a0a0a] border-surface-200 dark:border-[#282828] hover:border-primary-500/20')}>
                    <span className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', activeTab==='chat' ? 'bg-black text-primary-500' : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black')}><MessageSquare size={16}/></span>
                    <span className="flex-1"><span className={clsx('block text-sm font-black', activeTab==='chat' ? 'text-black' : 'text-[#0a0a0a] dark:text-white')}>Chat</span><span className={clsx('block text-xs font-medium', activeTab==='chat' ? 'text-black/60' : 'text-surface-500 dark:text-night-400')}>{effectiveCanChat ? 'Live' : 'Read-only'} {unreadChat && '· New'}</span></span>
                  </button>
                  <button onClick={()=> handleTabChange('resources')} className={clsx('w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all', activeTab==='resources' ? 'bg-primary-500 border-primary-500 text-black' : 'bg-surface-50 dark:bg-[#0a0a0a] border-surface-200 dark:border-[#282828] hover:border-primary-500/20')}>
                    <span className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', activeTab==='resources' ? 'bg-black text-primary-500' : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black')}><FileText size={16}/></span>
                    <span className="flex-1"><span className={clsx('block text-sm font-black', activeTab==='resources' ? 'text-black' : 'text-[#0a0a0a] dark:text-white')}>Resources</span><span className={clsx('block text-xs font-medium', activeTab==='resources' ? 'text-black/60' : 'text-surface-500 dark:text-night-400')}>{totalResources} files</span></span>
                  </button>
                  <button onClick={()=> handleTabChange('members')} className={clsx('w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all', activeTab==='members' ? 'bg-primary-500 border-primary-500 text-black' : 'bg-surface-50 dark:bg-[#0a0a0a] border-surface-200 dark:border-[#282828] hover:border-primary-500/20')}>
                    <span className={clsx('w-9 h-9 rounded-xl flex items-center justify-center', activeTab==='members' ? 'bg-black text-primary-500' : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black')}><Users size={16}/></span>
                    <span className="flex-1"><span className={clsx('block text-sm font-black', activeTab==='members' ? 'text-black' : 'text-[#0a0a0a] dark:text-white')}>Members</span><span className={clsx('block text-xs font-medium', activeTab==='members' ? 'text-black/60' : 'text-surface-500 dark:text-night-400')}>{members.length || room._count?.members || 0} people</span></span>
                  </button>
                  <button onClick={()=> setShowUpload(true)} className="w-full flex items-center gap-2 justify-center min-h-[44px] px-4 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-sm font-black hover:bg-black dark:hover:bg-zinc-100 transition-colors">
                    <Upload size={14}/> Upload Resource
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </BentoGrid>

        {/* Tabs — premium pill bar */}
        <motion.div variants={{ hidden:{opacity:0,y:10}, show:{opacity:1,y:0, transition:{ duration:0.4 } } }}>
          <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] p-2 flex items-center gap-2 flex-wrap">
            {[
              { key:'chat', label:'Chat', icon:MessageSquare, count: unreadChat ? 1 : 0 },
              { key:'resources', label:'Resources', icon:FileText, count: totalResources },
              { key:'members', label:'Members', icon:Users, count: members.length || room._count?.members || 0 },
            ].map(({key,label,icon:Icon,count})=> (
              <button key={key} onClick={()=> handleTabChange(key as RoomTabKey)} className={clsx('inline-flex items-center gap-2 px-4 h-11 rounded-full text-sm font-black transition-all', activeTab===key ? 'bg-primary-500 text-black shadow' : 'bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] text-surface-600 dark:text-night-300 hover:border-primary-500/20')}>
                <Icon size={14}/> {label}
                {count !== undefined && <span className={clsx('min-w-[20px] h-5 px-1.5 rounded-full text-xs font-black inline-flex items-center justify-center', activeTab===key ? 'bg-black text-white' : 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black')}>{count}{key==='chat' && unreadChat ? ' •' : ''}</span>}
                {key==='chat' && unreadChat && activeTab!==key && <span className="w-2 h-2 rounded-full bg-[#ff4b5c] animate-pulse"/>}
              </button>
            ))}
            {canManageSettings && (
              <button onClick={openChatSettings} className="ml-auto inline-flex items-center gap-1.5 px-4 h-11 rounded-full bg-surface-900 dark:bg-white text-white dark:text-black text-sm font-bold hover:bg-black dark:hover:bg-zinc-100 transition-colors">
                <Shield size={14}/> Settings
              </button>
            )}
          </div>
        </motion.div>

        {/* Content — wrapped in SectionCard glass */}
        <motion.div variants={{ hidden:{opacity:0,y:12}, show:{opacity:1,y:0, transition:{ duration:0.45 } } }}>
          <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-primary-500 via-primary-500 to-emerald-500" />
            <div className="p-5 sm:p-6">
              {/* Chat Tab */}
              {activeTab === 'chat' && user && (
                <RoomChatPanel
                  roomId={id!}
                  canChat={effectiveCanChat}
                  chatMode={room.chatMode || 'EVERYONE'}
                  currentUserId={user.id}
                  canDeleteForEveryone={
                    room.teacherId === user.id ||
                    user.role === 'SUPER_ADMIN' ||
                    (user.role === 'COLLEGE_ADMIN' && !!user.collegeId && room.teacher?.collegeId === user.collegeId)
                  }
                />
              )}

              {/* Members Tab */}
              {activeTab === 'members' && (
                <RoomMembersPanel
                  members={members}
                  teacher={room.teacher ? { id: room.teacher.id, name: room.teacher.name, email: room.teacher.email } : null}
                  currentUserId={user?.id || ''}
                  loading={membersLoading}
                  canManageCR
                  onToggleCR={handleToggleCR}
                />
              )}

              {/* Resources Tab */}
              {activeTab === 'resources' && (
                <RoomResourcesPanel
                  grouped={resources}
                  loading={resourcesLoading}
                  canManage
                  deletingId={deleting}
                  onUploadClick={() => setShowUpload(true)}
                  onDelete={handleDeleteResource}
                />
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Upload Modal — premium */}
      <Modal open={showUpload} onClose={() => { setShowUpload(false); setUploadTitle(''); setUploadCategory('lecture'); setUploadFile(null) }} title="Upload Resource" size="md">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-bold text-[#0a0a0a] dark:text-white mb-1 block">Title *</label>
            <input
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              className="w-full px-3 py-2.5 border border-surface-200 dark:border-[#282828] rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              placeholder="e.g., Lecture 1 - Introduction"
            />
          </div>
          <div>
            <label className="text-sm font-bold text-[#0a0a0a] dark:text-white mb-1 block">Category</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
              className="w-full px-3 py-2.5 border border-surface-200 dark:border-[#282828] rounded-xl text-sm bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            >
              <option value="lecture">Lectures</option>
              <option value="assignment">Assignments</option>
              <option value="reference">Reference</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-bold text-[#0a0a0a] dark:text-white mb-1 block">File *</label>
            <input
              type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2.5 border border-surface-200 dark:border-[#282828] rounded-xl text-sm dark:text-night-200 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-black file:bg-primary-500 file:text-black hover:file:bg-[#1ed760] bg-white dark:bg-[#0a0a0a]"
            />
            {uploadFile && (
              <p className="text-xs text-surface-500 dark:text-night-300 mt-1">{uploadFile.name} ({formatFileSize(uploadFile.size)})</p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setShowUpload(false); setUploadTitle(''); setUploadCategory('lecture'); setUploadFile(null) }}
              className="flex-1 px-4 h-11 bg-surface-100 dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] text-surface-700 dark:text-night-200 rounded-full font-bold hover:bg-surface-200 dark:hover:bg-[#262626] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadFile}
              className="flex-1 px-4 h-11 bg-primary-500 text-black rounded-full font-black hover:bg-[#1ed760] disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(30,215,96,0.3)]"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload
            </button>
          </div>
        </div>
      </Modal>

      {/* Chat Settings Modal */}
      <RoomChatSettingsModal
        open={showChatSettings}
        onClose={() => setShowChatSettings(false)}
        roomId={id!}
        chatMode={room.chatMode || 'EVERYONE'}
        allowedMembers={room.allowedMembers || []}
        members={members}
        onOptimisticSave={applyChatSettings}
        onSaveFailed={revertChatSettings}
      />
    </div>
  )
}
